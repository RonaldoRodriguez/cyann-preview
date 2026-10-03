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

## Licencia

Por definir. El proyecto está en fase de diseño y es probable que partes del lenguaje cambien de forma incompatible entre versiones. Si te interesa usarlo o extenderlo, abrí un issue primero para coordinar.
