![CI](https://github.com/RonaldoRodriguez/cyann-preview/actions/workflows/ci.yml/badge.svg)
# Cyann Preview

Un lenguaje de programación experimental que compila a WebAssembly sin recolector de basura, inspirado en Go, diseñado para ser legible, predecible y explícito sobre dónde vive cada byte.

---

## ¿Qué es cyann?

cyann es un lenguaje de programación de sistemas en desarrollo activo. Su objetivo es ofrecer la ergonomía y la claridad de Go —tipado nominal, structs, funciones como valores, sintaxis limpia— pero sin arrastrar un recolector de basura al binario final. Todo el manejo de memoria es explícito o implícito-por-scope, y el resultado se compila a WebAssembly puro (`wasm32`), sin WASI, sin imports del host, sin dependencias externas.

El proyecto nace como experimento personal, motivado por la traducción de Zig a Rust que hizo el equipo de Bun para reescribir su runtime. La pregunta que lo originó fue simple: *¿qué tan lejos se puede llegar escribiendo un compilador completo —lexer, parser, análisis semántico, optimizador, generador de código y emisor de bytecode— sin depender de LLVM ni de un backend externo?* La respuesta, hasta ahora, es: bastante lejos.

cyann no busca reemplazar a nadie. Busca ser un banco de pruebas para ideas sobre lenguajes sin GC, un ejercicio de ingeniería de compiladores hecho desde cero, y eventualmente —el objetivo a largo plazo— un lenguaje que se compile a sí mismo.

---

## Filosofía de diseño

Tres principios guían cada decisión del proyecto:

**Sin recolector de basura.** La memoria se administra con una arena de heap que crece bajo demanda y con regiones explícitas que liberan bloques completos. No hay barrido, no hay pausas, no hay sorpresas en tiempo de ejecución. El programador decide cuándo vive y cuándo muere cada región de memoria.

**Explícito sobre implícito.** Las conversiones de tipo son visibles. Los errores de tipado son errores de compilación, no de ejecución. Las capturas de closures son detectadas por el analizador semántico y transformadas en accesos a un entorno en el heap. Nada mágico ocurre por debajo.

**Portable por construcción.** El backend emite WebAssembly estándar. El mismo archivo `.cyn` compilado produce un `.wasm` que corre en cualquier runtime conforme a la especificación: wasmtime, wasmer, Node.js, Bun, navegadores. No hay código específico de plataforma, no hay syscalls, no hay convenciones de sistema operativo.

---

## El pipeline de compilación

cyann es un compilador de una sola pasada por etapa. Cada fase consume la salida de la anterior y produce una representación más cercana al binario final. El flujo completo es:

**Preprocesador.** Expande directivas `@include` resolviendo rutas relativas al archivo que las escribe. Un archivo ya incluido se ignora silenciosamente (equivalente a `#pragma once`); un archivo que ya está en la ruta actual de expansión se detecta como ciclo real y produce error.

**Lexer.** Tokeniza el código fuente en identificadores, palabras clave, números (con sufijos `u`, `l`, `f`, hex, bin, separadores `_`), strings, booleanos y símbolos. Preserva línea y columna para mensajes de error precisos.

**Parser.** Construye un AST de declaraciones y expresiones. Gramática de precedencia clásica en cascada: `||`, `&&`, `|`, `^`, `&`, `==`, `<`, `<<`, `+`, `*`, unarios, postfijos. Reconoce structs, tipos, alias, funciones, lambdas, métodos (próximamente), bloques `region`, `for`, `for...in`, `switch` con patterns, `return`, `break`, `continue`, imports `[host(...)]`.

**Analizador semántico.** Resuelve tipos, construye scopes, verifica asignabilidad, detecta capturas de closures, canonicaliza structs anónimos, registra alias, resuelve sobrecargas, valida patrones de `switch`, y hace análisis de escape básico para regiones. Es la fase más compleja del compilador.

**Optimizador.** Aplica *constant folding* sobre el AST. Toda expresión cuyas subexpresiones sean literales numéricos, booleanos o strings se evalúa en tiempo de compilación y se reemplaza por su resultado. Aritmética entera, comparaciones, casts, negación, complemento bit a bit.

**Generador de código.** Traduce cada función a IR intermedio, calcula qué funciones y closures son alcanzables desde los statements top-level (DCE temprano), crea las globals para los entornos de closures, e inicializa el runtime de strings y arena.

**Emisor de bytecode.** Serializa todo a WebAssembly binario: secciones de tipos, imports, funciones, tablas, memoria, globals, exports, elementos, código y datos. Emite LEB128 firmado y sin signo, floats IEEE-754 little-endian, y las secciones en orden canónico. Después corre DCE sobre el IR para eliminar funciones, imports y strings no referenciadas.

---

## Sistema de tipos

cyann distingue dos planos de tipos: los que existen a nivel de lenguaje (`MathType`) y los que existen a nivel de WebAssembly (`ValueType`, uno de `i32`, `i64`, `f32`, `f64`). El mapeo es determinista y está centralizado en `typeSystem.ts`.

### Tipos primitivos

- Enteros con signo: `s32`, `s64`
- Enteros sin signo: `u32`, `u64`
- Flotantes: `f32`, `f64`
- `bool` (representado como `i32`)
- `string` (puntero a un bloque con longitud + bytes UTF-8)

Alias como `int`, `int64`, `uint32`, `float64`, `size_t`, `usize`, `i8`, `u16`, `char`, `byte` se traducen a los anteriores en tiempo de parseo. Esto permite escribir código estilo Go o C sin cambiar el modelo de tipos interno.

### Tipos compuestos

- **Structs**: nominales o anónimos. `type Point struct { x int; y int }`. Los structs nominales con el mismo nombre son el mismo tipo; los anónimos se canonicalizan estructuralmente (mismo nombre + tipo de campos = mismo struct). Se asignan en el heap.
- **Arrays fijos**: `[3]int`, `[N]T`. Viven inline en el struct que los contiene, o en el heap como bloque contiguo.
- **Arrays dinámicos**: `[]int`. Un puntero a un bloque con longitud en la cabecera. Se crean con `make([]T, n)` o con literales.
- **Punteros**: `*T`. Representados como `i32`. `null` se codifica como `-1` para distinguirlo de un puntero válido.
- **Funciones**: `func(int) bool`, `fn(T1, T2) R`. Representadas como closures: un puntero a un bloque con el índice de tabla y las capturas.

### Promociones implícitas

El lenguaje permite algunas conversiones automáticas al asignar, todas ellas *widening* exacto:

- Entero de menor ancho a entero de mayor ancho: `s32 → s64`, `u32 → u64`
- Entero de hasta 32 bits a `f64`
- `f32 → f64`
- `null` a cualquier tipo referencia
- Struct a puntero al mismo struct
- Array fijo a array dinámico con el mismo tipo de elemento

Narrowing (`s64 → s32`, `f64 → f32`), cambio de signo (`s32 → u32`) y mezclas con `string` requieren cast explícito con `as`.

### Igualdad estructural

Los structs y arrays fijos se comparan campo por campo con `==` y `!=`. La comparación es profunda: si un campo es un struct, se compara recursivamente. El compilador detecta structs autorreferenciados y aborta con un mensaje claro si se intentaría generar código infinito. Los ciclos se rompen con `is_same`, que compara identidad de puntero sin dereferenciar.

---

## Modelo de memoria

Sin GC, sin `new`, sin `delete`. La memoria de cyann se administra con tres mecanismos complementarios.

### Arena de heap

El runtime mantiene un puntero global `__heap_ptr` y un límite `__mem_end`. Cada llamada a `arena_alloc(size)` alinea el puntero a 8 bytes, verifica que quepa, y si no, crece la memoria lineal con `memory.grow` en páginas de 64 KiB. Nunca libera individualmente: la arena sólo avanza.

Los structs, dynarrays, strings y cajas de capturas viven en la arena. Un struct literal `Point{x: 1, y: 2}` reserva su espacio y devuelve un `i32` que es el puntero. No hay copia: asignar un struct a otro copia el puntero, no el contenido.

### Regiones

Un bloque `region { ... }` guarda el puntero de arena al entrar y lo restaura al salir. Todo lo alocado adentro se libera de golpe, sin recorrer estructuras, sin marcar, sin recorrer ciclos. Es el equivalente a un `alloca` con scope grande o a una arena transitoria de un frame de compilación.

```cyann
region {
    var xs []int = make([]int, 1000)
    // ... trabajar con xs ...
}
// aquí todo lo de xs ya es inalcanzable; el siguiente alloc lo reusa
```

El analizador semántico hace *escape analysis* básico: si un valor alocado dentro de una región se intenta guardar en un slot de nivel exterior, produce error de compilación. Los `return` dentro de una región también restauran la arena antes de salir, así que devolver un valor alocado adentro de la región es seguro —el valor se copia fuera antes de que el `restore` ocurra.

Aquí va la sección para pegar en el README. Va después de la sección "Pattern matching" (o donde prefieras, yo la pondría justo después de "Closures", porque un método no es más que un closure con receiver):

---

## Métodos

cyann soporta métodos definidos sobre structs nominales usando una sintaxis de receiver entre corchetes. El receiver se escribe antes de `func` y el struct al que pertenece el método:
```cyann
    type Person struct {
        name string
        age  int
    }

    [Person]
    func greet() {
        print("hola, soy ")
        print(self.name)
        print(" y tengo ")
        print_int(self.age)
        println(" años")
    }

    [Person]
    func get_age() int {
        return self.age
    }

    [Person]
    func set_age(n int) {
        self.age = n
    }
```
Dentro del cuerpo del método, `self` es una variable implícita de tipo `Person` que apunta al struct receptor. Podés leer sus campos (`self.name`, `self.age`) y mutarlos (`self.age = n`). El nombre `self` está reservado dentro de un método: no podés declarar un parámetro con ese nombre.

### Invocación

Un método se invoca con la sintaxis de punto sobre una instancia:
```cyann
    var p = Person { name: "Ronaldo", age: 30 }
    p.greet()
    var edad int = p.get_age()
    p.set_age(31)
```
El compilador desugara `p.get_age()` a una llamada directa `get_age(p)` sin allocación intermedia. Los métodos son tan baratos como las funciones libres a las que se reducen.

### Reglas

- El receiver debe ser un **struct nominal**. No se admiten receivers sobre tipos anónimos, primitivos, arrays, punteros, ni funciones.
- Un struct puede tener cualquier cantidad de métodos, con cualquier combinación de parámetros y tipo de retorno.
- El nombre del método puede coincidir con el nombre de un campo. Si lo hace, **el campo gana**: `p.name` accede al campo, no al método. Si querés llamar al método, usá un nombre distinto.
- Los métodos no participan del sistema de sobrecarga. No podés declarar dos métodos con el mismo nombre sobre el mismo struct.
- `self` siempre apunta al struct, nunca se copia. Aunque el método no mute nada, `self` es un puntero y el acceso a sus campos es un dereferenciado.

### Method values

Un método sin paréntesis se convierte en un **method value**: un closure que captura el receptor y puede invocarse más tarde.
```cyann
    func apply_method() int {
        var c = Counter { value: 10 }
        var f = c.bump      // method value: closure que captura c
        var x = f()         // 11
        var y = f()         // 12
        return x + y        // 23
    }
```
El binding es **estático**: `f` captura el `Counter` que existía al momento de crear el closure, no la variable `c`. Si después reasignás `c = otro_counter`, `f` sigue operando sobre el original. Es el comportamiento que esperarías de Go o Rust, no el `this` dinámico de JavaScript.

El method value se implementa con un thunk hoisteado que extrae `self` del entorno del closure y llama al método real. No hay reflection ni dispatch dinámico por nombre. La resolución del método ocurre en tiempo de compilación.

### Interacción con funciones libres

Un método puede llamarse como una función libre usando el nombre del struct:
```cyann
    var q = Person { name: "Z", age: 50 }
    var edad int = get_age(q)   // equivalente a q.get_age()
```
El compilador mangla el nombre real del método internamente (por ejemplo `get_age__SP`), pero ese detalle nunca es visible al programador. Desde el lenguaje, `get_age` es una función que toma un `Person` como primer argumento y puede invocarse tanto con la sintaxis de punto como con la sintaxis funcional.

### Cuándo usar métodos

Los métodos son una herramienta de organización, no de polimorfismo. cyann no tiene herencia, ni interfaces, ni vtables. Un método sobre `Person` no puede redefinirse sobre un tipo derivado — simplemente no hay tipos derivados. Si necesitás comportamiento compartido entre structs distintos, usá funciones libres que tomen el struct como parámetro, o pasá callbacks.

La ventaja del método es la ergonomía: `p.greet()` se lee mejor que `greet(p)` cuando el primer argumento es el sujeto de la operación. La desventaja potencial es la ambigüedad campo/método, que se resuelve con la regla "campo gana". En la práctica, mantener nombres distintos para campos y métodos es una buena disciplina y evita sorpresas.

### Ejemplo completo

El archivo `examples/methods.cyn` cubre todos los casos: métodos básicos, métodos que mutan, métodos con argumentos y retorno, métodos sobre literales, method values con estado compartido, y llamadas por nombre de struct. Corrélo con:
```bash
    bun src/run.ts examples/methods.cyn demos/methods.wasm   
    wasmtime demos/methods.wasm
```

para ver los 8 checks de la suite de métodos.

---

### Cajas de captura

Cuando un lambda captura una variable del scope envolvente, el analizador marca esa variable como `boxed`. El codegen la coloca en el heap (una caja de `sizeOfType` bytes) y el lambda accede a ella vía el `__env`. Esto permite que mutaciones dentro del lambda se reflejen en el scope exterior y viceversa, como esperaría alguien viniendo de JavaScript o Python, pero sin la ambigüedad de un `this` dinámico.

---

## Closures

Los closures son un ciudadano de primera clase. Un lambda `func(x int) int { return x + offset }` capturando `offset` se compila a:

- Una función hoisteada `__lambda_N(env: i32, x: i32) -> i32`
- Un bloque en el heap de tamaño `8 + 8 * n_capturas` con el índice de tabla del código y las capturas
- Un `global __funcenv_X` o `__closure_env_X` para lambdas sin capturas (que reusan el mismo env en cada sitio de uso)

El codegen detecta lambdas sin capturas y crea su env una sola vez en `_start`. Las que sí capturan alocan el env cada vez que la expresión lambda se evalúa.

Llamar a un closure usa `call_indirect` con el tipo deducido de la firma. Los argumentos se empujan con el `__env` como primer parámetro implícito.

---

## Multi-return

Una función puede retornar más de un valor. La sintaxis toma la forma de Go: los tipos de retorno se agrupan entre paréntesis y las expresiones del `return` se separan por comas.

```cynn
    func divmod(a int, b int) (int, int) {
        return a / b, a % b
    }

    func parse_int(s string) (int, bool) {
        if s == "cuarenta" { return 40, true }
        if s == "cincuenta" { return 50, true }
        return 0, false
    }
```
Los tipos de retorno pueden mezclar cualquier combinación: enteros, flotantes, strings, bools, structs, punteros, arrays, y funciones. No hay un límite sintáctico en la cantidad de valores.

### Destructuring

Del lado del llamador, los valores se capturan con una declaración múltiple. Dos formas son válidas, ambas equivalentes:

```cynn
    var q, r = divmod(17, 5)
    a, b := divmod(100, 7)
```
El compilador verifica que la cantidad de nombres coincida con la cantidad de valores retornados por la función. Si no coinciden, error de compilación.

### Wildcards

Un guión bajo como nombre descarta el valor correspondiente. Útil cuando sólo te interesa una parte del retorno:

```cynn
    var _, r = divmod(17, 5)      // sólo el resto
    var q, _ = divmod(17, 5)      // sólo el cociente
    var _, _ = divmod(99, 9)      // descarta ambos (raro pero válido)
```

El `_` no crea un binding en el scope. No podés referenciarlo después.

### En métodos

Los métodos soportan multi-return sin cambios sintácticos:

```cynn
    type Point struct { x int; y int }

    [Point]
    func coords() (int, int) {
        return self.x, self.y
    }

    [Point]
    func sum_and_diff() (int, int) {
        return self.x + self.y, self.x - self.y
    }

    var p = Point { x: 3, y: 4 }
    var px, py = p.coords()
    var sm, df = p.sum_and_diff()
```

### Representación en WebAssembly

El módulo resultante usa la extensión **multi-value** de WebAssembly: la firma de la función se emite como `(func (param ...) (result t1 t2 ...))` y el `return` deja los N valores en la pila. El `CALL` no necesita ninguna instrucción especial. Todos los engines modernos (wasmtime, Bun, Node, navegadores) soportan multi-value desde hace años.

La extensión se usa **sólo** para retornos. Los parámetros de función siguen siendo uno por uno. Si en algún momento querés que una función tome N valores como argumento (por ejemplo `foo(divmod(a, b))`), esa es otra feature — pasa por tuplas como valor de primera clase y no está soportada.

### Lo que no está soportado

- **Multi-return como argumento de función.** `foo(divmod(a, b))` no compila. Primero capturá en variables y pasá las variables.
- **Multi-return en `if` y `for`.** El patrón Go `if _, err = f(); err != nil { ... }` no existe todavía. Por ahora declarás con `var` o `:=` fuera del `if`.
- **Reasignación múltiple.** `q, r = divmod(a, b)` sobre variables ya existentes no está soportado. La declaración múltiple sí.
- **Multi-return desde lambdas.** Las funciones literales (`func(...) { ... }` inline) no soportan múltiples tipos de retorno todavía. Los métodos y las funciones nominales sí.

### Ejemplo completo

`examples/multi_return.cyn` cubre los seis escenarios: divmod básico, tipos mixtos, early returns, métodos con multi-return, composición de llamadas, y wildcards. Corré:

```bash
    bun src/run.ts examples/multi_return.cyn
```

## Pattern matching

Los `switch` de cyann soportan pattern matching estructural:

- **Wildcard** `_` que matchea cualquier valor
- **Literales** numéricos, strings y booleanos
- **Structs** con campos anidados: `Point{x: 0, y: _}`
- **`null`** para tipos referencia
- **Múltiples patrones por caso**: `case 1, 2, 3:`
- **Anidamiento arbitrario**: `Wrap{p: Point{x: 1, y: 1}, tag: 42}`

El chequeo es exhaustivo a nivel de structs: si un patrón `Point{...}` no menciona todos los campos, es error de compilación. Esto fuerza al programador a ser explícito sobre qué campos importan y qué campos ignora.

---

## Sintaxis

Un archivo `.cyn` es una secuencia de declaraciones top-level. Los includes se resuelven antes del parseo.

```cyann
@include("lib/std.cyn")

// Structs
type Point struct { x int; y int }

// Alias de tipo
type IntList []int
type Predicate func(int) bool

// Variables globales
var g_pass int = 0
var g_fail int = 0

// Funciones
func add(a int, b int) int { return a + b }

func apply(f Predicate, x int) bool { return f(x) }

// Lambdas
var is_even Predicate = func(x int) bool { return x % 2 == 0 }

// Pattern matching sobre structs
func describe(p Point) int {
    switch p {
    case null:              return 0
    case Point{x: 0, y: 0}: return 1
    case Point{x: 0, y: _}: return 2
    case Point{x: _, y: 0}: return 3
    case _:                 return 5
    }
    return -1
}

// Regiones para memoria transitoria
func sum_squares(n int) int {
    region {
        var xs []int = make([]int, n)
        for i in 0..n { xs[i] = i * i }
        var total int = 0
        for x in xs { total = total + x }
        return total
    }
}

// Iteración
func print_all(xs []int) {
    for x in xs { println_int(x) }
}

// Main
func main() {
    println("cyann")
    println_int(add(2, 3))
    if apply(is_even, 10) { println("10 es par") }
    println_int(describe(Point{x: 0, y: 5}))
    print_all([1, 2, 3])
}

main()
```

---

## Toolchain

cyann se ejecuta sobre Bun. No requiere un compilador de C, no requiere LLVM, no requiere instalar wasm-ld. El único requisito es Bun en el PATH.

### Compilar un archivo

```
bun src/run.ts examples/pattern_match.cyn demos/pattern_match.wasm
```

Esto produce un `.wasm` puro. Podés inspeccionarlo con `wasm-objdump`, `wasm2wat` o el visor de tu elección.

### Compilar y ejecutar en un paso

```
bun src/run.ts examples/pattern_match.cyn
```

Sin segundo argumento, `run.ts` instancia el módulo con `WebAssembly.instantiate` (sin imports, sin WASI) y llama a `_start`. Todo el output viene de `println` y `print_int` definidos en `lib/std_v2.cyn`.

### Ejecutar con wasmtime

```
wasmtime demos/pattern_match.wasm
```

El `.wasm` no tiene dependencias del host, así que corre en cualquier runtime conforme.

### Suite de tests

Windows (PowerShell):

```
.\run-all.ps1
```

El script compila cada `.cyn` en `examples/`, lo ejecuta, y verifica el conteo de `Pasan:` / `Fallan:` contra los marcadores que cada demo imprime. Un archivo que termina con `Fallan: 0` cuenta como suite OK. Un archivo que *debe* fallar en compilación cuenta como OK si el error es el esperado.

### Chequeo de tipos de TypeScript

```
bunx tsc --noEmit
```

Debe terminar sin output. El proyecto apunta a strict mode con `noUnreachableCode`, `noFallthroughCasesInSwitch` y `noImplicitOverride`.

---

## Estructura del proyecto

```
src/
  lexer.ts          Tokenizador: identificadores, literales, símbolos
  parser.ts         AST y parser recursivo descendente
  semantic.ts       Análisis semántico: tipos, scopes, closures, patterns
  typeSystem.ts     sizeOf, alignOf, conversión MathType ↔ ValueType
  mangler.ts        Codificación inyectiva de tipos en nombres de función
  constants.ts      Constant folding: aritmética, comparaciones, casts
  optimizer.ts      Recorrido del AST aplicando foldConstants
  codegen.ts        IR por función, runtime de arena y strings, DCE temprano
  compiler.ts       Emisor WASM: secciones, LEB128, decodificador WAT
  dce.ts            Dead code elimination: funciones, imports, strings
  preprocessor.ts   Expansión de @include con detección de ciclos
  run.ts            CLI: compila y ejecuta (o sólo escribe .wasm)
  types.ts          MathType, nodos del AST, TypeRegistry
examples/           Un .cyn por feature, cada uno con su suite de checks
lib/                std.cyn, std_v2.cyn, utilidades de impresión
demos/              .wasm generados por la suite
```

---

## Qué está cubierto hoy

El lenguaje soporta structs nominales y anónimos, arrays fijos y dinámicos, punteros, closures con capturas por caja, pattern matching en switch con wildcards y anidamiento, comparación estructural de structs y arrays, alias de tipos incluyendo alias de alias, regiones con escape analysis, constant folding sobre el AST, DCE de funciones y strings no referenciadas, sobrecarga de funciones por aridad y tipo de parámetros, y compilación a WebAssembly sin imports.

## Qué falta

El roadmap inmediato cubre métodos con `self` (azúcar sobre `func f(self: T)` con reuso de la maquinaria de closures), multi-return, privacidad por convención `_name` entre módulos, y DCE de las globals auxiliares de closures. Más adelante: introspección de tipos, un sistema de módulos más rico, y eventualmente compilar cyann con cyann.

## Cómo contribuir

Los issues son bienvenidos para discutir sintaxis, semántica, o features nuevas. Los tests son la fuente de verdad del proyecto: si agregás algo, agregá un `.cyn` en `examples/` que lo cubra, con checks que impriman `Pasan:` y `Fallan:` al final. Corré `bunx tsc --noEmit` y `.\run-all.ps1` antes de abrir un PR. El estilo es explícito: pocas abstracciones, tipos claros, cero dependencias externas en el runtime.

---

## Nota

Por definir. El proyecto está en fase de diseño y es probable que partes del lenguaje cambien de forma incompatible entre versiones. Si te interesa usarlo o extenderlo, abrí un issue primero para coordinar.

## Licencia

Este proyecto está bajo la Licencia MIT. Consulta el archivo [LICENSE](LICENSE) para más detalles.
