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

Los parámetros finales pueden tener valores por defecto. Si se omiten en una llamada directa, el compilador añade esas expresiones como argumentos; los valores por defecto se evalúan en cada llamada y pueden usar símbolos globales, pero no parámetros de la función. Las llamadas mediante variables de función requieren la firma completa:

```cyann
func add(a int, b int = 10) int {
    return a + b
}

func main() {
    println(add(5))    // 15
    println(add(5, 2)) // 7
}
```

Los valores por defecto deben ser compatibles con el tipo declarado y los parámetros opcionales deben estar al final. Si una llamada omitida coincide con más de una sobrecarga, se reporta ambigüedad. [`default_parameters.cyn`](examples/default_parameters.cyn) y [`default_parameter_import.cyn`](examples/default_parameter_import.cyn) cubren funciones, métodos e imports; los archivos `default_parameter_*_should_fail.cyn` verifican errores de declaración y resolución.

### Parámetros variádicos

Una función puede declarar un único parámetro variádico, siempre al final, con la forma `values ...int`. Dentro de la función, ese parámetro se comporta como un array dinámico del tipo declarado y puede recorrerse con `for`. Al llamar, se pasan cero o más argumentos individuales; el compilador los empaqueta en ese array. Las sobrecargas fijas compatibles tienen prioridad frente a las variádicas.

```cyann
func sum(values ...int) int {
    var total int = 0
    for value in values {
        total = total + value
    }
    return total
}
```

Todos los argumentos empaquetados deben tener el mismo tipo compatible con el parámetro; la función recibe los valores en el orden original. Por ahora, no se admite combinar tipos diferentes en una misma llamada ni declarar más de un parámetro variádico. [`std::println`](examples/lib/std.cyn) tiene overloads variádicos para strings, `int` y `bool`; imprime los valores seguidos, sin separadores, y termina con un salto de línea. [`variadic_parameters.cyn`](examples/variadic_parameters.cyn) demuestra iteración, sobrecargas y el uso de `std::println`; los ejemplos `variadic_*_should_fail.cyn` comprueban los errores de tipos y declaración.

### Interpolación de strings

Los strings interpolados usan `$"..."`; las expresiones se escriben entre llaves y `{{`/`}}` producen llaves literales. Se admiten expresiones de tipo `string`, `bool`, `int`/`s32` y `u32`; flotantes y expresiones sin valor no se permiten todavía.

```cyann
var name string = "Cyann"
var version int = 1
println($"Hola, {name} v{version}; {{experimental}}")
```

[`string_interpolation.cyn`](examples/string_interpolation.cyn) cubre expresiones, conversiones y escapes de llaves; los ejemplos `string_interpolation_*_should_fail.cyn` comprueban tipos no admitidos y errores de sintaxis.

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

Las llamadas de método se resuelven durante la compilación. Los métodos organizan operaciones alrededor de un tipo; no implican herencia ni despacho virtual. Una lista de receptores especializa estáticamente el método para cada struct:

```cyann
[Point, Size]
func clear() {
    self.x = 0
    self.y = 0
}
```

El cuerpo se comprueba para cada receptor, por lo que todos deben tener campos compatibles que se utilicen en él.

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

Los módulos Cyann pueden importar funciones, tipos y variables exportadas desde una ruta relativa al archivo importador. Un import selectivo introduce solo el símbolo solicitado:

```cyann
import "lib/math.cyn"::max
import "lib/std.cyn" as std

func main() {
    std::println(max(20, 22))
}
```

También se puede importar el módulo bajo un alias. Sus exports se usan con `::` y no entran al ámbito sin calificar:

```cyann
import "lib/std.cyn" as std

func main() {
    std::println(std::max(20, 22))
}
```

El `as` de esta declaración no se confunde con el cast `value as int`: el alias solo se acepta en la gramática de una sentencia `import`. Los nombres locales pueden coincidir con miembros del módulo, pues se accede a estos mediante el alias. Los tipos exportados también se califican, por ejemplo `var point api::Point = api::make_point(1, 2)`.

Los módulos pueden exponer explícitamente otro módulo con `export import`, para componer APIs en varios niveles:

```cyann
export import "io.cyn" as io

// Un consumidor puede usar: package::io::println(...)
```

Un import de módulo normal no se reexporta. Los ciclos de importación se rechazan durante la carga, incluyendo ciclos entre módulos reexportados.

En `lib/math.cyn`, el símbolo se hace público con `export`:

```cyann
export func max(a int, b int) int {
    if a > b { return a }
    return b
}
```

Los módulos se cargan una vez por ruta. Cada módulo recibe un espacio de nombres interno para sus funciones, globals y tipos; las dependencias solo son visibles en el módulo importador mediante el import explícito. Los imports selectivos y los imports con alias permiten acceder a funciones sobrecargadas; Semantic elige la sobrecarga a partir de la firma exportada. Los ciclos de importación, los nombres duplicados y las referencias a símbolos privados o no importados producen errores.

Los imports solo se permiten en el nivel superior. Las funciones y variables globales exportadas se publican en WebAssembly; los tipos son símbolos de compilación y no generan exports binarios. Los exports del módulo de entrada conservan su nombre en WebAssembly; los exports de módulos dependientes se publican con un nombre calificado por ruta, como `lib/math.cyn::max`, para evitar colisiones. Los `@include` se expanden por módulo y sus declaraciones quedan dentro del espacio de nombres de ese módulo.

La prueba ejecutable [`module_linking.cyn`](examples/module_linking.cyn) enlaza funciones transitivas con nombres privados, globals, tipos e includes repetidos; [`module_namespace.cyn`](examples/module_namespace.cyn) demuestra el acceso calificado a funciones sobrecargadas, tipos y globals; [`module_nested_namespace.cyn`](examples/module_nested_namespace.cyn) prueba namespaces reexportados en varios niveles; [`module_nested_private_namespace_should_fail.cyn`](examples/module_nested_private_namespace_should_fail.cyn) comprueba que un import privado no se reexporta; [`module_type_global_exports.cyn`](examples/module_type_global_exports.cyn) prueba los imports selectivos; [`module_overload_import.cyn`](examples/module_overload_import.cyn) comprueba la selección de una sobrecarga importada.

Los imports del host usan una declaración explícita con la firma completa:

```cyann
import host("wasi_snapshot_preview1", "fd_write")
func host_write(fd int, iovs int, count int, written int) int
```

El nombre local (`host_write`) puede diferir del campo externo (`fd_write`). El módulo WebAssembly debe ejecutarse en un host que proporcione el import indicado. La biblioteca de impresión de los ejemplos usa WASI de esta manera.

La forma anterior `[host("módulo", "nombre")] func ...` se acepta temporalmente para facilitar la migración, pero la sintaxis `import host(...)` es la forma recomendada.

### Biblioteca estándar de ejemplo

La biblioteca unificada [`examples/lib/std.cyn`](examples/lib/std.cyn) reúne utilidades pequeñas para los programas del repositorio: `print`/`println`, salida de enteros y booleanos, `panic`/`assert`, `min`, `max`, `clamp`, `abs`, `sign`, paridad y conversiones básicas a string. Sus funciones públicas se exportan para poder importarla bajo un alias:

Prefiere el import con alias para no introducir esos nombres en el ámbito local:

```cyann
import "lib/std.cyn" as std

func main() {
    std::println("total:")
    std::println(std::clamp(100, 0, 50)) // 50
    std::println(std::str_from_bool(std::int_is_even(12))) // true
}

main()
```

`@include("lib/std.cyn")` aún se admite para demos antiguos, pero expande las declaraciones en el archivo y no ofrece aislamiento léxico. Estos helpers no establecen una API estable. Los helpers enteros usan `int` de 32 bits; `clamp(value, low, high)` espera que `low <= high`. `abs` de `int` no puede representar el valor positivo de `-2147483648` en `s32`, por lo que ese caso conserva el comportamiento de overflow del entero de 32 bits.

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
- [`multi_struct_method.cyn`](examples/multi_struct_method.cyn): especialización estática de métodos para varios structs.
- [`multi_struct_method_should_fail.cyn`](examples/multi_struct_method_should_fail.cyn): valida el cuerpo para cada receptor y rechaza campos que faltan en alguno de los structs.
- [`default_parameters.cyn`](examples/default_parameters.cyn): valores por defecto en llamadas a funciones y métodos.
- [`default_parameter_import.cyn`](examples/default_parameter_import.cyn): valores por defecto en una función importada.
- [`default_parameter_not_trailing_should_fail.cyn`](examples/default_parameter_not_trailing_should_fail.cyn): rechaza parámetros obligatorios después de uno opcional.
- [`default_parameter_type_should_fail.cyn`](examples/default_parameter_type_should_fail.cyn): rechaza valores por defecto incompatibles con el tipo.
- [`default_parameter_scope_should_fail.cyn`](examples/default_parameter_scope_should_fail.cyn): rechaza identificadores no disponibles en el ámbito global de defaults.
- [`default_parameter_depends_on_parameter_should_fail.cyn`](examples/default_parameter_depends_on_parameter_should_fail.cyn): rechaza defaults dependientes de parámetros.
- [`default_parameter_ambiguous_should_fail.cyn`](examples/default_parameter_ambiguous_should_fail.cyn): detecta llamadas ambiguas por sobrecargas con defaults.
- [`variadic_parameters.cyn`](examples/variadic_parameters.cyn): parámetros variádicos, iteración y overloads variádicos de `println`.
- [`variadic_mixed_types_should_fail.cyn`](examples/variadic_mixed_types_should_fail.cyn): rechaza argumentos de tipos mezclados en una llamada variádica.
- [`variadic_not_last_should_fail.cyn`](examples/variadic_not_last_should_fail.cyn): rechaza parámetros posteriores al variádico.
- [`variadic_default_should_fail.cyn`](examples/variadic_default_should_fail.cyn): rechaza valores por defecto en el parámetro variádico.
- [`string_interpolation.cyn`](examples/string_interpolation.cyn): interpolación de strings, expresiones, booleanos, enteros con signo/sin signo y llaves literales.
- [`string_interpolation_float_should_fail.cyn`](examples/string_interpolation_float_should_fail.cyn): rechaza la interpolación de flotantes.
- [`string_interpolation_unclosed_should_fail.cyn`](examples/string_interpolation_unclosed_should_fail.cyn): detecta strings interpolados sin cerrar.
- [`string_interpolation_void_should_fail.cyn`](examples/string_interpolation_void_should_fail.cyn): rechaza la interpolación de expresiones sin valor.
- [`multi_return.cyn`](examples/multi_return.cyn): retornos múltiples, descarte de resultados y métodos con varios resultados.
- [`forward_decl.cyn`](examples/forward_decl.cyn): referencias a funciones declaradas más adelante.
- [`pattern_match.cyn`](examples/pattern_match.cyn): patrones de `switch`, incluidos wildcard y patrones de structs.

### Structs, igualdad y optimización

- [`struct_compare.cyn`](examples/struct_compare.cyn): comparación estructural de structs.
- [`nested_struct_eq.cyn`](examples/nested_struct_eq.cyn): igualdad de structs anidados y valores `null`.
- [`struct_eq_cache.cyn`](examples/struct_eq_cache.cyn): reutilización de comparaciones estructurales.
- [`multi_struct_method.cyn`](examples/multi_struct_method.cyn): especialización estática de un mismo método para varios structs.
- [`multi_struct_method_should_fail.cyn`](examples/multi_struct_method_should_fail.cyn): valida el cuerpo para cada receptor y rechaza campos que faltan en alguno de los structs.
- [`array_eq_dce.cyn`](examples/array_eq_dce.cyn): igualdad de arrays y eliminación de código muerto.
- [`pointer_identity.cyn`](examples/pointer_identity.cyn): identidad de referencias frente a igualdad por contenido.
- [`dce_demo.cyn`](examples/dce_demo.cyn): eliminación de funciones y código no alcanzables.

### Preprocesador, runtime e integración

- [`preprocessor.cyn`](examples/preprocessor.cyn): expansión idempotente de includes repetidos.
- [`module_linking.cyn`](examples/module_linking.cyn): importación de una función Cyann, enlace en un solo binario y ejecución.
- [`module_namespace.cyn`](examples/module_namespace.cyn): acceso a funciones, tipos y variables globales mediante alias de módulo.
- [`module_nested_namespace.cyn`](examples/module_nested_namespace.cyn): acceso a través de varios módulos reexportados.
- [`module_nested_private_namespace_should_fail.cyn`](examples/module_nested_private_namespace_should_fail.cyn): rechaza el acceso a una dependencia que no fue reexportada.
- [`module_namespace_no_leak_should_fail.cyn`](examples/module_namespace_no_leak_should_fail.cyn): comprueba que el alias no introduce funciones con nombres globales en el ámbito local.
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
