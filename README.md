![CI](https://github.com/RonaldoRodriguez/cyann-preview/actions/workflows/ci.yml/badge.svg)

# Cyann Preview

Cyann es un lenguaje experimental, de tipado estático y compilado a WebAssembly para `wasm32`. Su sintaxis toma ideas de Go. El compilador y el runtime están escritos en TypeScript y se ejecutan con Bun.

El proyecto sigue en desarrollo y la sintaxis puede cambiar. Los ejemplos de `examples/` muestran las características implementadas y forman parte de las pruebas de regresión. Los binarios correspondientes se generan en `demos/`.

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

Guarda lo siguiente como `hello.cyn` en la raíz del repositorio:

```cyann
import "examples/lib/std.cyn" as std

func add(a int, b int) int {
    return a + b
}

func main() {
    std::println("Hola desde Cyann")
    std::println(add(20, 22))
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

La biblioteca estándar de ejemplo implementa la salida mediante imports WASI. Por eso, los programas que la usan requieren un runtime que proporcione esos imports. Lo mismo se aplica a cualquier programa que declare imports del host.

## Características del lenguaje

### Tipos, variables y conversiones

Los tipos numéricos incorporados son `s32`, `u32`, `s64`, `u64`, `f32` y `f64`; también existen `bool` y `string`. Nombres comunes como `int` y `uint` son alias de los tipos numéricos del lenguaje. Las variables se declaran con `var`; el tipo puede indicarse explícitamente o inferirse desde el valor inicial.

```cyann
var count int = 3
var label string = "items"
var enabled bool = true

var next = count + 1
var wide s64 = count       // widening permitido
var small s32 = wide as s32 // narrowing explícito
```

El destino actual es **WebAssembly de 32 bits**: punteros, direcciones de memoria y tamaños usados por el runtime caben en 32 bits; `int` corresponde a `s32`. Aunque existen los tipos `s64`/`u64` y el backend puede emitir operaciones `i64`, su soporte es parcial/experimental: no convierten el objetivo en un runtime ni en un espacio de direcciones de 64 bits. Para el camino más probado actualmente, usa `int`/`s32` y `u32`. La biblioteca estándar ofrece sus helpers enteros sobre `int` de 32 bits.

Los tipos de las expresiones se comprueban antes de generar WebAssembly. Las conversiones implícitas son limitadas; para conversiones que pueden perder información, usa `as`. Los nombres introducidos con `type Name T` son aliases transparentes: se resuelven al tipo subyacente y no crean un tipo nominal distinto.

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

Los parámetros finales pueden tener valores por defecto. Si se omiten en una llamada directa, el compilador añade esas expresiones como argumentos; los valores por defecto se evalúan en cada llamada y pueden usar símbolos globales, pero no parámetros de la función. Las llamadas mediante variables de función requieren todos los argumentos de su firma:

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

Una función o función literal (closure) puede declarar un único parámetro variádico, siempre al final, con la forma `values ...int`. Dentro de la función, ese parámetro se comporta como un array dinámico del tipo declarado y puede recorrerse con `for`. Al llamar, se pasan cero o más argumentos individuales; el compilador los empaqueta en ese array. Las sobrecargas fijas compatibles tienen prioridad frente a las variádicas.

```cyann
func sum(values ...int) int {
    var total int = 0
    for value in values {
        total = total + value
    }
    return total
}
```

Los tipos de los argumentos empaquetados deben coincidir entre sí y ser compatibles con el tipo del parámetro; los valores conservan su orden. No se admite más de un parámetro variádico ni parámetros después de este. [`std::println`](examples/lib/std.cyn) ofrece sobrecargas variádicas para strings, `int` y `bool`; imprime los valores seguidos, sin separadores, y termina con un salto de línea. [`variadic_parameters.cyn`](examples/variadic_parameters.cyn) y [`closure_variadic.cyn`](examples/closure_variadic.cyn) demuestran su uso en funciones y closures.

Los tipos de función también pueden expresar una firma variádica, por ejemplo `func(int, ...int) int`. [`closure_variadic_mixed_types_should_fail.cyn`](examples/closure_variadic_mixed_types_should_fail.cyn) comprueba que no se mezclen tipos incompatibles en los argumentos empaquetados; `variadic_*_should_fail.cyn` cubre otras declaraciones no válidas.

### Interpolación de strings

Los strings interpolados usan `$"..."`; las expresiones se escriben entre llaves y `{{`/`}}` producen llaves literales. Se admiten expresiones de tipo `string`, `bool`, `int`/`s32` y `u32`; flotantes y expresiones sin valor no se permiten todavía.

```cyann
var name string = "Cyann"
var version int = 1
println($"Hola, {name} v{version}; {{experimental}}")
```

[`string_interpolation.cyn`](examples/string_interpolation.cyn) cubre expresiones, conversiones y escapes de llaves; los ejemplos `string_interpolation_*_should_fail.cyn` comprueban tipos no admitidos y errores de sintaxis.

### Control de flujo e iteración

Hay `if`/`else`, `switch`, tres formas de bucle `for` (clásico, condicionado e infinito), iteración sobre rangos y colecciones, y `break`/`continue`. Los bucles pueden tener etiquetas para controlar un bucle exterior.

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
}
```

`switch` también admite patrones sobre strings, booleanos, `null` y structs. Los patrones de struct pueden anidarse; `_` representa un campo o valor que no importa. Para garantizar un retorno desde un `if`, tanto la rama `if` como la rama `else` deben retornar. El análisis también reconoce un `switch` exhaustivo si tiene `default`, un patrón `case _` o, cuando la expresión es booleana, cubre `true` y `false`; todas sus ramas deben retornar. Un bucle no se considera retorno garantizado, ya que puede no ejecutarse o terminar sin retornar.

### Structs, arrays y alias

Los structs agrupan campos con nombre. `type Name T` define un alias transparente, incluidos aliases de tipos compuestos. Los arrays fijos tienen longitud conocida y `[]T` representa un array dinámico.

`key_values(TipoStruct)` recibe el nombre de un struct (no una instancia) y devuelve un array dinámico de arrays de dos strings: `[nombreCampo, tipoDeclarado]`. La metadata se determina durante la compilación y conserva la grafía declarada, como `int` en lugar de `s32`, además de aliases y tipos compuestos. También acepta un alias de struct.

```cyann
type Person struct {
    nombre string
    edad int
}

var fields = key_values(Person)
// fields[0] == ["nombre", "string"]
// fields[1] == ["edad", "int"]
```

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

Los literales de array pueden inicializar arrays fijos o dinámicos según el tipo esperado. Los arrays dinámicos pueden crearse con `make([]T, n)` y su longitud se consulta con `len(xs)`. El compilador está dirigido a `wasm32`, así que el tamaño e indexación de la memoria siguen sujetos a ese límite. Para detalles de igualdad y aliasing, consulta [Igualdad e identidad](#igualdad-e-identidad).

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
type IntSum func(int, ...int) int

func apply(f IntTransform, value int) int {
    return f(value)
}

func main() {
    var offset int = 5
    var add_offset IntTransform = func(value int) int {
        return value + offset
    }
    println(apply(add_offset, 7)) // 12

    var sum IntSum = func(initial int, values ...int) int {
        var total int = initial
        for value in values {
            total = total + value
        }
        return total
    }
    println(sum(0, 1, 2, 3)) // 6
}
```

Las funciones literales admiten parámetros variádicos al final, igual que las funciones declaradas. La firma del tipo de función también puede expresarlos con `...T`. El compilador representa las funciones como closures y prepara el entorno de capturas. Las variables capturadas que necesitan compartirse se guardan en cajas administradas por el runtime.

### Igualdad e identidad

`==` y `!=` comparan structs y arrays de forma estructural: recorren sus campos o elementos, también cuando contienen otros structs. Los tipos de campo deben admitir esa comparación. Los strings se comparan por contenido.

`is_same(a, b)` comprueba identidad de referencia y se admite para tipos de referencia (como structs, punteros, arrays dinámicos, strings y funciones). Es útil para distinguir dos referencias diferentes con el mismo contenido:

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

Los módulos se cargan una vez por ruta. Cada módulo recibe un espacio de nombres interno para sus funciones, variables globales y tipos; las dependencias solo son visibles en el módulo importador mediante el import explícito. Los imports selectivos y los imports con alias permiten acceder a funciones sobrecargadas; el análisis semántico elige la sobrecarga a partir de la firma exportada. Los ciclos de importación, los nombres duplicados y las referencias a símbolos privados o no importados producen errores.

Los imports solo se permiten en el nivel superior. Las funciones y variables globales exportadas se publican en WebAssembly; los tipos son símbolos de compilación y no generan exports binarios. Los exports del módulo de entrada conservan su nombre en WebAssembly; los exports de módulos dependientes se publican con un nombre calificado por ruta, como `lib/math.cyn::max`, para evitar colisiones. Los `@include` se expanden por módulo y sus declaraciones quedan dentro del espacio de nombres de ese módulo.

Las pruebas ejecutables [`module_linking.cyn`](examples/module_linking.cyn), [`module_namespace.cyn`](examples/module_namespace.cyn), [`module_nested_namespace.cyn`](examples/module_nested_namespace.cyn), [`module_type_global_exports.cyn`](examples/module_type_global_exports.cyn) y [`module_overload_import.cyn`](examples/module_overload_import.cyn) cubren enlace, namespaces anidados, exports y resolución de sobrecargas. [`module_nested_private_namespace_should_fail.cyn`](examples/module_nested_private_namespace_should_fail.cyn) comprueba que un import privado no se reexporta.

Los imports del host usan una declaración explícita con la firma completa:

```cyann
import host("wasi_snapshot_preview1", "fd_write")
func host_write(fd int, iovs int, count int, written int) int
```

El nombre local (`host_write`) puede diferir del campo externo (`fd_write`). El módulo WebAssembly debe ejecutarse en un host que proporcione el import indicado. La biblioteca de impresión de los ejemplos usa WASI de esta manera.

La forma anterior `[host("módulo", "nombre")] func ...` se acepta temporalmente para facilitar la migración, pero la sintaxis `import host(...)` es la forma recomendada.

### Biblioteca estándar de ejemplo

La biblioteca de ejemplo [`examples/lib/std.cyn`](examples/lib/std.cyn) agrupa utilidades para los programas del repositorio: `print`/`println`, salida por `stderr`, salida de enteros y booleanos, `panic`/`assert`, helpers numéricos (`min`, `max`, `clamp`, `abs`, `sign`, paridad) y conversiones y comprobaciones básicas de strings. Sus funciones públicas se exportan para poder importarla bajo un alias:

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

`@include("lib/std.cyn")` aún se admite para demos antiguos, pero expande las declaraciones en el archivo y no ofrece aislamiento léxico. Es una biblioteca de ejemplo, no una API estable del lenguaje. Los helpers enteros usan `int` de 32 bits; `clamp(value, low, high)` espera que `low <= high`. `abs` de `int` no puede representar el valor positivo de `-2147483648` en `s32`, por lo que ese caso conserva el comportamiento de overflow del entero de 32 bits.

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

# Ejecutar un ejemplo o un patrón de nombres
.\run-all.ps1 pattern_match.cyn
.\run-all.ps1 closure_variadic*.cyn
```

La suite examina los archivos `.cyn` de primer nivel en `examples/` y escribe los WebAssembly resultantes en `demos/`. Los archivos `*_should_fail.cyn` deben fallar al compilar; los archivos `trap_*.cyn` deben compilar y producir un trap en runtime; los demás deben ejecutarse sin fallos. Los archivos auxiliares de `examples/lib/` se compilan cuando los importa otro ejemplo.

[`std_library.cyn`](examples/std_library.cyn) comprueba las utilidades agrupadas en `std.cyn`, incluidos límites de conversión del entero `s32`. También puedes ejecutar las verificaciones con `bun run test:ps`.

## Arquitectura del compilador

El pipeline del compilador se divide en estas etapas:

1. `preprocessor.ts` expande includes.
2. `lexer.ts` convierte el texto en tokens.
3. `parser.ts` construye el AST.
4. `semantic.ts` resuelve nombres, tipos y ámbitos, valida el control de flujo y genera diagnósticos; entrega un programa analizado.
5. `optimizer.ts` pliega constantes en el AST y elimina elementos no alcanzables del módulo.
6. `codegen.ts` traduce el programa analizado a instrucciones IR.
7. `compiler.ts` construye el módulo y emite el WebAssembly binario.
8. `wasmInspector.ts` decodifica módulos para producir WAT o un árbol de secciones; `wasmSimd.ts` comparte metadatos SIMD entre inspección y emisión.

`types.ts` contiene los tipos del lenguaje y nodos del AST. `typeSystem.ts` centraliza operaciones compartidas, como comparación, asignabilidad y layout de structs. `constants.ts` contiene inferencia de literales y plegado de constantes; `mangler.ts` codifica tipos y nombres de funciones.

## Ejemplos disponibles

Los ejemplos ejecutables de `examples/` sirven como documentación práctica y pruebas de regresión. La suite incluye tanto casos válidos como archivos cuyo nombre termina en `_should_fail.cyn`, que verifican diagnósticos esperados. `todo_demo.cyn` ofrece una demostración amplia de integración.

### Tipos, expresiones y memoria

- [`operators.cyn`](examples/operators.cyn): precedencia, operadores aritméticos, bitwise y lógicos, conversiones y `++`/`--`.
- [`type_alias.cyn`](examples/type_alias.cyn): aliases de tipos primitivos, compuestos, structs y funciones.
- [`arrays_memory.cyn`](examples/arrays_memory.cyn): arrays fijos y dinámicos, `make`, indexación, punteros, asignación de memoria y `size_of`.
- [`key_values.cyn`](examples/key_values.cyn): reflexión de campos y tipos declarados de structs, incluidos aliases y firmas de función.
- [`key_values_module.cyn`](examples/key_values_module.cyn): reflexión de un struct importado mediante namespace.
- [`pointer_identity.cyn`](examples/pointer_identity.cyn): identidad de referencias frente a igualdad por contenido.
- [`test_size_of.cyn`](examples/test_size_of.cyn): tamaños de primitivos, structs, punteros y arrays en `wasm32`.

### Funciones y control de flujo

- [`control_flow.cyn`](examples/control_flow.cyn): ramas `if`/`else`, formas de `for`, `break`, `continue` y `switch`.
- [`labeled_loops.cyn`](examples/labeled_loops.cyn): bucles anidados y saltos etiquetados.
- [`pattern_match.cyn`](examples/pattern_match.cyn): patrones de `switch` y ramas exhaustivas.
- [`function_values.cyn`](examples/function_values.cyn): referencias a funciones, callbacks y capturas de closures.
- [`closure_variadic.cyn`](examples/closure_variadic.cyn): parámetros variádicos en funciones literales y llamadas a closures.
- [`multi_return.cyn`](examples/multi_return.cyn): múltiples resultados y descarte de valores con `_`.
- [`default_parameters.cyn`](examples/default_parameters.cyn): parámetros por defecto en llamadas directas y métodos.
- [`variadic_parameters.cyn`](examples/variadic_parameters.cyn): parámetros variádicos en funciones y sobrecargas.
- [`string_interpolation.cyn`](examples/string_interpolation.cyn): interpolación, conversiones admitidas y llaves literales.
- [`methods.cyn`](examples/methods.cyn) y [`multi_struct_method.cyn`](examples/multi_struct_method.cyn): métodos y especialización estática para varios structs.

### Módulos, diagnósticos y optimización

- [`module_linking.cyn`](examples/module_linking.cyn): carga y enlace de módulos Cyann en un único binario.
- [`module_namespace.cyn`](examples/module_namespace.cyn) y [`module_nested_namespace.cyn`](examples/module_nested_namespace.cyn): imports con alias, tipos exportados y namespaces reexportados.
- [`module_overload_import.cyn`](examples/module_overload_import.cyn): resolución de sobrecargas importadas.
- [`preprocessor.cyn`](examples/preprocessor.cyn): expansión de includes repetidos.
- [`diagnostic_include_should_fail.cyn`](examples/diagnostic_include_should_fail.cyn), [`diagnostic_parse_include_should_fail.cyn`](examples/diagnostic_parse_include_should_fail.cyn) y [`diagnostic_entry_should_fail.cyn`](examples/diagnostic_entry_should_fail.cyn): ubicaciones de diagnósticos en archivos incluidos y de entrada.
- [`array_eq_dce.cyn`](examples/array_eq_dce.cyn) y [`dce_demo.cyn`](examples/dce_demo.cyn): igualdad de arrays y eliminación de código muerto.
- [`todo_demo.cyn`](examples/todo_demo.cyn): demostración de integración con structs, arrays, memoria, regiones y closures.

### Comportamientos de fallo esperados

Los archivos con sufijo `_should_fail.cyn` forman parte de la suite y deben ser rechazados durante la compilación. Por ejemplo:

- [`closure_variadic_mixed_types_should_fail.cyn`](examples/closure_variadic_mixed_types_should_fail.cyn): rechaza argumentos de tipos incompatibles en una closure variádica.
- [`function_missing_return_if_should_fail.cyn`](examples/function_missing_return_if_should_fail.cyn): verifica que un `if` sin rama alternativa no garantiza el retorno.
- [`key_values_non_struct_should_fail.cyn`](examples/key_values_non_struct_should_fail.cyn): rechaza el uso de `key_values` con un tipo que no es un struct.

Los archivos `trap_*.cyn` deben compilar y producir un trap durante la ejecución; [`trap_array_bounds.cyn`](examples/trap_array_bounds.cyn) y [`trap_null_struct_access.cyn`](examples/trap_null_struct_access.cyn) cubren accesos inválidos. Al añadir una característica, incluye un ejemplo de comportamiento válido y, cuando corresponda, pruebas de rechazo o de trap.

## Estado del proyecto

Cyann es un proyecto en evolución, no un lenguaje con compatibilidad estable. El objetivo es que el frontend valide el programa antes de que el backend genere código; algunas características y diagnósticos pueden cambiar mientras se desarrolla esa separación.

## Licencia

Este proyecto está bajo la Licencia MIT. Consulta [LICENSE](LICENSE) para más detalles.
