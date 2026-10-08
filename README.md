![CI](https://github.com/RonaldoRodriguez/cyann-preview/actions/workflows/ci.yml/badge.svg)

# Cyann Preview

Cyann es un lenguaje experimental, tipado estáticamente y compilado al objetivo `wasm32`. Su sintaxis toma ideas de Go; el compilador y el runtime están escritos en TypeScript y se ejecutan con Bun.

El proyecto sigue en desarrollo y la sintaxis puede cambiar. Los ejemplos de `examples/` son la referencia práctica de las características implementadas; los binarios de `demos/` se generan a partir de ellos y se usan para comprobar regresiones.

## Inicio rápido

### Requisitos

- [Bun](https://bun.sh/) para ejecutar el compilador.
- [Wasmtime](https://wasmtime.dev/) solo si quieres ejecutar por separado un archivo `.wasm` o correr la suite completa.

Desde la raíz del proyecto, instala las dependencias y comprueba el compilador:

```powershell
bun install
bun run check
```

### Primer programa

Guarda lo siguiente como `hello.cyn` en la raíz del repositorio. El include apunta a la biblioteca que se conserva en `examples/lib/`.

```cyann
@include("examples/lib/std.cyn")

func add(a int, b int) int {
    return a + b
}

func main() {
    println("Hola desde Cyann")
    println(add(20, 22))
}

main()
```

Compílalo y ejecútalo directamente con Bun:

```powershell
bun src/run.ts hello.cyn
```

También puedes escribir un módulo y ejecutarlo con Wasmtime:

```powershell
bun src/run.ts hello.cyn hello.wasm
wasmtime hello.wasm
```

El include de la biblioteca de ejemplo incorpora funciones de impresión implementadas mediante imports WASI. Por eso, los módulos que la usan requieren un runtime con soporte WASI. Los programas que declaran imports del host también dependen de los imports correspondientes al ejecutarse.

## Características del lenguaje

### Tipos, variables y conversiones

Los tipos numéricos incorporados son `s32`, `u32`, `s64`, `u64`, `f32` y `f64`; también existen `bool` y `string`. Nombres comunes como `int` y `uint` son alias de los tipos numéricos del lenguaje. Las variables pueden declarar el tipo o inferirlo con `:=`.

```cyann
var count int = 3
var label string = "items"
var enabled bool = true

var next = count + 1
var wide s64 = count       // widening permitido
var small s32 = wide as s32 // narrowing explícito
```

El destino actual es **WebAssembly de 32 bits**: punteros, direcciones de memoria y tamaños usados por el runtime caben en 32 bits; `int` corresponde a `s32`. Aunque existen los tipos `s64`/`u64` y el backend puede emitir operaciones `i64`, su soporte es parcial/experimental: no convierten el objetivo en un runtime ni en un espacio de direcciones de 64 bits. Para el camino más probado actualmente, usa `int`/`s32` y `u32`. La biblioteca estándar ofrece sus helpers enteros sobre `int` de 32 bits.

Los tipos de las expresiones se comprueban antes de generar WebAssembly. Las conversiones implícitas son limitadas; para conversiones que pueden perder información, usa `as`.

### Funciones, sobrecarga y múltiples resultados

Las funciones declaran sus parámetros y tipo de retorno. Se pueden sobrecargar por tipos de parámetros, y una función puede devolver varios valores.

```cyann
func describe(n int) string {
    return "entero"
}

func describe(n f64) string {
    return "decimal"
}

func divmod(a int, b int) (int, int) {
    return a / b, a % b
}

func main() {
    var quotient, remainder = divmod(17, 5)
    println(quotient)  // 3
    println(remainder) // 2
}
```

Los resultados múltiples se capturan al declarar varios nombres, por ejemplo `var quotient, remainder = divmod(17, 5)`. El `_` permite descartar una posición. Los resultados de una llamada no se expanden automáticamente como argumentos de otra función.

### Decisiones e iteración

Hay `if`/`else`, `switch`, bucles `for`, iteración sobre rangos y colecciones, y `break`/`continue`. Los bucles pueden tener etiquetas para controlar un bucle exterior.

```cyann
func sum_to(n int) int {
    var total int = 0
    for i in 0..n {
        total = total + i
    }
    return total
}

func classify(n int) string {
    switch n {
    case 0: return "cero"
    case 1, 2, 3: return "pequeno"
    case _: return "otro"
    }
    return "otro"
}
```

`switch` también admite patrones sobre strings, booleanos, `null` y structs. Los patrones de struct pueden anidarse; `_` representa un campo o valor que no importa.

### Structs, arrays y alias

Los structs agrupan campos con nombre. Los tipos definidos pueden ser alias de otros tipos; los arrays fijos tienen longitud conocida y `[]T` representa un array dinámico.

```cyann
type Point struct {
    x int
    y int
}

type IntList []int

func move(p Point, dx int) Point {
    return Point{x: p.x + dx, y: p.y}
}

func first(xs []int) int {
    return xs[0]
}
```

Los literales de array pueden inicializar arrays fijos o dinámicos según el tipo esperado. Los arrays dinámicos pueden crearse con `make([]T, n)` y su longitud se consulta con `len(xs)`. El compilador de runtime actual está dirigido a wasm32, así que el tamaño e indexación de la memoria siguen sujetos a ese límite. Para detalles de igualdad y aliasing, consulta [Igualdad e identidad](#igualdad-e-identidad).

### Métodos

Un método se asocia a un struct nominal mediante un atributo `[Tipo]`; dentro del cuerpo, `self` es el receptor.

```cyann
type Counter struct {
    value int
}

[Counter]
func increment() {
    self.value = self.value + 1
}

func main() {
    var c = Counter{value: 0}
    c.increment()
}
```

Las llamadas de método se resuelven durante la compilación. Los métodos organizan operaciones alrededor de un tipo; no implican herencia ni despacho virtual.

### Funciones como valores y closures

Las funciones pueden guardarse en variables y pasarse como argumentos. Las funciones literales pueden capturar variables del ámbito donde se crean.

```cyann
type IntTransform func(int) int

func apply(f IntTransform, value int) int {
    return f(value)
}

func main() {
    var offset int = 5
    var add_offset IntTransform = func(value int) int {
        return value + offset
    }
    println(apply(add_offset, 7)) // 12
}
```

El compilador representa las funciones como closures y prepara el entorno de capturas. Las variables capturadas que necesitan compartirse se guardan en cajas administradas por el runtime.

### Igualdad e identidad

`==` y `!=` comparan structs y arrays de forma estructural: recorren sus campos o elementos, también cuando contienen otros structs. Los tipos de campo deben admitir esa comparación. Los strings se comparan por contenido.

`is_same(a, b)` comprueba identidad de referencia, útil para distinguir dos objetos diferentes con el mismo contenido:

```cyann
type Point struct { x int; y int }

func main() {
    var a = Point{x: 1, y: 2}
    var b = Point{x: 1, y: 2}
    var alias = a

    if a == b { println("mismo contenido") }
    if !is_same(a, b) { println("objetos distintos") }
    if is_same(a, alias) { println("misma referencia") }
}
```

`null` puede asignarse a tipos de referencia. El backend lo representa con un valor centinela distinto de los punteros válidos.

### Memoria y regiones

Cyann no tiene recolector de basura. El runtime usa una arena para asignaciones como structs, arrays dinámicos, strings y entornos de closures. Las asignaciones individuales no se liberan una a una.

Un bloque `region` permite usar memoria temporal y restaurar el estado de la arena al salir del bloque:

```cyann
func sum_squares(n int) int {
    region {
        var values []int = make([]int, n)
        for i in 0..n {
            values[i] = i * i
        }

        var total int = 0
        for value in values {
            total = total + value
        }
        return total
    }
}
```

El análisis semántico incluye comprobaciones de escape para evitar que una referencia a memoria de una región sobreviva al ámbito que la administra.

### Includes e módulos

`@include("ruta")` expande otro archivo antes del análisis. La ruta se resuelve respecto al archivo que contiene la directiva; los includes repetidos se procesan una sola vez y los ciclos producen un error.

Los módulos Cyann pueden importar una función exportada desde una ruta relativa al archivo importador. La función se enlaza dentro del mismo binario y su firma se toma de la definición exportada:

```cyann
import "lib/math.cyn"::max

func main() {
    println(max(20, 22))
}
```

En `lib/math.cyn`, el símbolo se hace público con `export`:

```cyann
export func max(a int, b int) int {
    if a > b { return a }
    return b
}
```

Los módulos se cargan una vez por ruta. Cada módulo recibe un espacio de nombres interno para sus funciones, globals y tipos; las dependencias solo son visibles en el módulo importador mediante el import explícito. Se pueden exportar e importar funciones, tipos y variables globales; también se pueden importar funciones sobrecargadas, y Semantic elige la sobrecarga a partir de la firma exportada. Los ciclos de importación, los nombres duplicados y las referencias a símbolos privados o no importados producen errores.

Los imports solo se permiten en el nivel superior. Las funciones y variables globales exportadas se publican en WebAssembly; los tipos son símbolos de compilación y no generan exports binarios. Los exports del módulo de entrada conservan su nombre en WebAssembly; los exports de módulos dependientes se publican con un nombre calificado por ruta, como `lib/math.cyn::max`, para evitar colisiones. Los `@include` se expanden por módulo y sus declaraciones quedan dentro del espacio de nombres de ese módulo.

La prueba ejecutable [`module_linking.cyn`](examples/module_linking.cyn) enlaza funciones transitivas con nombres privados, globals, tipos e includes repetidos; [`module_type_global_exports.cyn`](examples/module_type_global_exports.cyn) prueba la importación de un alias, un struct y una variable global exportados; [`module_overload_import.cyn`](examples/module_overload_import.cyn) comprueba la selección de una sobrecarga importada. [`module_private_function_should_fail.cyn`](examples/module_private_function_should_fail.cyn), [`module_unimported_symbol_should_fail.cyn`](examples/module_unimported_symbol_should_fail.cyn), [`module_non_exported_symbol_should_fail.cyn`](examples/module_non_exported_symbol_should_fail.cyn), [`module_duplicate_import_should_fail.cyn`](examples/module_duplicate_import_should_fail.cyn), [`module_cycle_should_fail.cyn`](examples/module_cycle_should_fail.cyn) y [`module_nested_import_should_fail.cyn`](examples/module_nested_import_should_fail.cyn) comprueban errores de visibilidad, colisiones y estructura.

Los imports del host usan una declaración explícita con la firma completa:

```cyann
import host("wasi_snapshot_preview1", "fd_write")
func host_write(fd int, iovs int, count int, written int) int
```

El nombre local (`host_write`) puede diferir del campo externo (`fd_write`). El módulo WebAssembly debe ejecutarse en un host que proporcione el import indicado. La biblioteca de impresión de los ejemplos usa WASI de esta manera.

La forma anterior `[host("módulo", "nombre")] func ...` se acepta temporalmente para facilitar la migración, pero la sintaxis `import host(...)` es la forma recomendada.

### Biblioteca estándar de ejemplo

La biblioteca unificada [`examples/lib/std.cyn`](examples/lib/std.cyn) reúne utilidades pequeñas para los programas del repositorio: `print`/`println`, salida de enteros y booleanos, `panic`/`assert`, `min`, `max`, `clamp`, `abs`, `sign`, paridad y conversiones básicas a string.

Inclúyela una sola vez desde un archivo de `examples/`:

```cyann
@include("lib/std.cyn")

func main() {
    println("total:")
    println(clamp(100, 0, 50)) // 50
    println(str_from_bool(int_is_even(12))) // true
}

main()
```

Estos helpers no sustituyen módulos ni establecen una API estable. Los helpers enteros usan `int` de 32 bits; `clamp(value, low, high)` espera que `low <= high`. `abs` de `int` no puede representar el valor positivo de `-2147483648` en `s32`, por lo que ese caso conserva el comportamiento de overflow del entero de 32 bits.

## Herramientas y pruebas

### Compilar o ejecutar un archivo

```powershell
# Compilar y ejecutar con Bun/WASI
bun src/run.ts examples/pattern_match.cyn

# Escribir el módulo, sin ejecutarlo
bun src/run.ts examples/pattern_match.cyn output.wasm

# Ejecutar el archivo generado
wasmtime output.wasm
```

`src/run.ts` compila y ejecuta si no se especifica una salida. Para ejecutar, intenta cargar WASI desde Bun y luego desde `node:wasi`; si ninguna opción está disponible, compila a `.wasm` y usa un runtime externo como Wasmtime. Si se indica un archivo de salida, solo escribe el WebAssembly.

Los errores de parser y análisis semántico muestran `archivo:línea:columna`. El preprocesador conserva el origen de cada fragmento de `@include`, así que la ubicación señala el archivo original, no la línea virtual del texto expandido. Los ejemplos `diagnostic_*_should_fail.cyn` hacen aserciones ejecutables sobre esas ubicaciones.

### Comprobaciones del proyecto

```powershell
# Tipos de TypeScript
bun run check

# Suite completa de ejemplos (requiere Wasmtime)
.\run-all.ps1

# Ejecutar un ejemplo específico
.\run-all.ps1 pattern_match.cyn
```

La suite compila archivos de `examples/` y escribe los WebAssembly resultantes en `demos/`; ejecutar un caso vuelve a generar su archivo `.wasm` correspondiente. Los ejemplos incluyen tanto pruebas que deben compilar como casos que deben ser rechazados.

[`std_library.cyn`](examples/std_library.cyn) comprueba las utilidades agrupadas en `std.cyn`, incluidos límites de conversión del entero `s32`.

## Arquitectura del compilador

El pipeline es explícito; cada módulo se ocupa de una parte:

1. `preprocessor.ts` expande includes.
2. `lexer.ts` convierte el texto en tokens.
3. `parser.ts` construye el AST.
4. `semantic.ts` resuelve nombres, tipos, scopes y diagnósticos; entrega un programa analizado.
5. `optimizer.ts` pliega constantes en el AST y elimina elementos no alcanzables del módulo.
6. `codegen.ts` traduce el programa analizado a instrucciones IR.
7. `compiler.ts` construye el módulo y emite el WebAssembly binario.
8. `wasmInspector.ts` decodifica módulos para producir WAT o un árbol de secciones; `wasmSimd.ts` comparte metadatos SIMD entre inspección y emisión.

`types.ts` contiene los tipos del lenguaje y nodos de AST. `typeSystem.ts` centraliza operaciones compartidas, como comparación/asignabilidad y layout de structs. `constants.ts` contiene inferencia de literales y plegado de constantes; `mangler.ts` codifica tipos y nombres de funciones.

## Ejemplos disponibles

Cada archivo ejecutable de `examples/` tiene un foco concreto; `todo_demo.cyn` conserva además una demostración amplia de integración. La lista sirve como mapa de cobertura y los ejemplos se ejecutan con `.\run-all.ps1`.

### Expresiones, tipos y datos

- [`operators.cyn`](examples/operators.cyn): precedencia, aritmética, bitwise, lógica, conversiones y `++`/`--`.
- [`type_alias.cyn`](examples/type_alias.cyn): alias y tipos definidos, incluidos tipos de función.
- [`arrays_memory.cyn`](examples/arrays_memory.cyn): arrays fijos y dinámicos, literales, `make`, indexación, iteración y `size_of` en wasm32.
- [`array_index_type_should_fail.cyn`](examples/array_index_type_should_fail.cyn): rechazo semántico de índices que no son enteros de 32 bits.
- [`float_remainder_should_fail.cyn`](examples/float_remainder_should_fail.cyn): rechazo del operador de resto aplicado a flotantes.
- [`test_size_of.cyn`](examples/test_size_of.cyn): tamaños de tipos primitivos, structs, punteros y arrays; los tamaños `i64`/`f64` no implican un objetivo de 64 bits.

### Funciones y control de flujo

- [`control_flow.cyn`](examples/control_flow.cyn): ramas `if`/`else if`, ámbitos, variantes de `for`, `continue`, `break` y `switch`.
- [`labeled_loops.cyn`](examples/labeled_loops.cyn): rangos, iteración con índice, loops anidados y saltos etiquetados.
- [`function_values.cyn`](examples/function_values.cyn): referencias a funciones, callbacks, lambdas y capturas mutables/independientes.
- [`methods.cyn`](examples/methods.cyn): métodos, receptores y valores de método.
- [`multi_return.cyn`](examples/multi_return.cyn): retornos múltiples, descarte de resultados y métodos con varios resultados.
- [`forward_decl.cyn`](examples/forward_decl.cyn): referencias a funciones declaradas más adelante.
- [`pattern_match.cyn`](examples/pattern_match.cyn): patrones de `switch`, incluidos wildcard y patrones de structs.

### Structs, igualdad y optimización

- [`struct_compare.cyn`](examples/struct_compare.cyn): comparación estructural de structs.
- [`nested_struct_eq.cyn`](examples/nested_struct_eq.cyn): igualdad de structs anidados y valores `null`.
- [`struct_eq_cache.cyn`](examples/struct_eq_cache.cyn): reutilización de comparaciones estructurales.
- [`array_eq_dce.cyn`](examples/array_eq_dce.cyn): igualdad de arrays y eliminación de código muerto.
- [`pointer_identity.cyn`](examples/pointer_identity.cyn): identidad de referencias frente a igualdad por contenido.
- [`dce_demo.cyn`](examples/dce_demo.cyn): eliminación de funciones y código no alcanzables.

### Preprocesador, runtime e integración

- [`preprocessor.cyn`](examples/preprocessor.cyn): expansión idempotente de includes repetidos.
- [`module_linking.cyn`](examples/module_linking.cyn): importación de una función Cyann, enlace en un solo binario y ejecución.
- [`module_overload_import.cyn`](examples/module_overload_import.cyn): resolución semántica de overloads importados.
- [`module_type_global_exports.cyn`](examples/module_type_global_exports.cyn): importación de tipos y globals exportados.
- [`module_private_function_should_fail.cyn`](examples/module_private_function_should_fail.cyn): rechazo del uso directo de una función privada del módulo.
- [`module_non_exported_symbol_should_fail.cyn`](examples/module_non_exported_symbol_should_fail.cyn): rechazo de imports cuyo símbolo no está exportado.
- [`module_duplicate_import_should_fail.cyn`](examples/module_duplicate_import_should_fail.cyn): rechazo de dos imports que colisionan en el mismo nombre local.
- [`module_unimported_symbol_should_fail.cyn`](examples/module_unimported_symbol_should_fail.cyn): rechazo del uso de un símbolo exportado transitivo que el módulo no importó directamente.
- [`module_cycle_should_fail.cyn`](examples/module_cycle_should_fail.cyn): rechazo de dependencias cíclicas.
- [`module_nested_import_should_fail.cyn`](examples/module_nested_import_should_fail.cyn): rechazo de imports fuera del nivel superior.
- [`diagnostic_include_should_fail.cyn`](examples/diagnostic_include_should_fail.cyn): error semántico intencional en un include; el diagnóstico debe señalar el archivo incluido y su línea 4.
- [`diagnostic_parse_include_should_fail.cyn`](examples/diagnostic_parse_include_should_fail.cyn): error de sintaxis intencional en un include; el parser debe señalar el archivo incluido y su línea 3.
- [`diagnostic_entry_should_fail.cyn`](examples/diagnostic_entry_should_fail.cyn): error semántico en el archivo de entrada; el diagnóstico debe señalar su línea 3.
- [`std_library.cyn`](examples/std_library.cyn): comprobaciones de la biblioteca `std.cyn` y de límites de enteros `s32`.
- [`type.cyn`](examples/type.cyn): salida y utilidades del runtime que dependen de WASI.
- [`todo_demo.cyn`](examples/todo_demo.cyn): integración de structs, arrays, memoria, regiones, closures, callbacks y otras características.
- [`prueba.cyn`](examples/prueba.cyn): smoke test mínimo de ejecución.

### Comportamientos de fallo esperados

Estos archivos son parte de la suite: los `*_should_fail.cyn` deben ser rechazados durante la compilación y los `trap_*.cyn` deben compilar y fallar al ejecutarse.

- [`is_same_on_primitives_should_fail.cyn`](examples/is_same_on_primitives_should_fail.cyn): `is_same` no acepta tipos primitivos.
- [`trap_array_bounds.cyn`](examples/trap_array_bounds.cyn): acceso a un índice fuera de límites.
- [`trap_null_struct_access.cyn`](examples/trap_null_struct_access.cyn): acceso a un campo a través de una referencia `null`.

No elimines los ejemplos ni los binarios de `demos/`: son la regresión ejecutable del proyecto. Si incorporas una característica, agrega un ejemplo que la compruebe y ejecuta las validaciones.

## Estado del proyecto

Cyann es un proyecto en evolución, no un lenguaje con compatibilidad estable. El objetivo es que el frontend valide el programa antes de que el backend genere código; algunas características y diagnósticos pueden cambiar mientras se desarrolla esa separación.

## Licencia

Este proyecto está bajo la Licencia MIT. Consulta [LICENSE](LICENSE) para más detalles.
