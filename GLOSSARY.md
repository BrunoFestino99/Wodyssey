# Wodyssey

Gestión de entrenamientos para boxes y entrenadores de entrenamiento funcional y fuerza.

## Lenguaje

**Cuenta**:
Identidad de acceso de una persona en Wodyssey, vinculada a una dirección de correo electrónico verificada. Una cuenta puede pertenecer a varias organizaciones y asumir los roles de entrenador y alumno.
_Evitar_: alumno, entrenador u organización como sinónimos de cuenta.

**Trabajo**:
Actividad de entrenamiento con un resultado propio, que puede ser un ejercicio individual o un circuito completo. Es la unidad sobre la que puede habilitarse un leaderboard.
_Evitar_: bloque como sinónimo de trabajo, porque no necesariamente coinciden.

**Trabajo de referencia**:
Trabajo guardado por el planificador para volver a programarlo y comparar los resultados de sus distintas apariciones como retesteos.
_Evitar_: nombre del trabajo como identificador suficiente de un retesteo.

**Variante de trabajo de referencia**:
Versión vinculada a un trabajo de referencia con cambios en su prescripción, como ejercicios, repeticiones o duración. Sus resultados se comparan por separado de los del original.
_Evitar_: retesteo idéntico como sinónimo de variante.

**Leaderboard**:
Clasificación de resultados de alumnos para un trabajo, habilitada por el entrenador o box.
_Evitar_: clasificación general de alumnos como sinónimo de leaderboard por trabajo.

**Grupo de alumnos**:
Conjunto de alumnos de una organización al que el planificador puede asignar un programa de forma conjunta, conservando las adaptaciones individuales.
_Evitar_: organización como sinónimo de grupo de alumnos.

**Planificador**:
Rol de quien define y modifica el contenido y la disposición de los entrenamientos que recibe el alumno, en representación de un box o como entrenador independiente.
_Evitar_: alumno como responsable de modificar la planificación.

**Organización**:
Espacio propio de un box o entrenador independiente que reúne a sus entrenadores, alumnos y programas. Un alumno puede pertenecer a varias organizaciones con una única cuenta.
_Evitar_: gimnasio como sinónimo general de organización, cuenta como sinónimo de organización.

**Entrenador**:
Persona que publica y asigna entrenamientos a alumnos y revisa su progreso.
_Evitar_: profe, profesor como términos alternativos en la documentación del dominio.

**Alumno**:
Persona que consulta sus entrenamientos asignados y registra lo realizado.
_Evitar_: usuario como sinónimo de alumno, porque también hay usuarios entrenadores.

**Programa**:
Planificación compuesta por sesiones de entrenamiento que puede asignarse a uno o varios alumnos. Un alumno puede tener varios programas asignados simultáneamente.
_Evitar_: rutina, planificación como términos alternativos de programa en la documentación del dominio.

**Sesión**:
Unidad de entrenamiento que forma parte de un programa y describe lo que el alumno debe realizar en una ocasión.
_Evitar_: programa como sinónimo de sesión.

**Sesión de acceso**:
Periodo durante el cual una cuenta autenticada mantiene el acceso a Wodyssey.
_Evitar_: sesión de entrenamiento como sinónimo de sesión de acceso.

**Asignación**:
Vínculo por el que un alumno recibe un programa de entrenamiento.
_Evitar_: programa como sinónimo de su asignación a un alumno.

**Adaptación individual**:
Cambio en el entrenamiento asignado a un alumno respecto del programa compartido, sin modificar lo que reciben los demás alumnos.
_Evitar_: edición del programa como sinónimo de adaptación individual.

**Administrador de la organización**:
Persona que gestiona los permisos y las responsabilidades de los entrenadores, con acceso a todos los alumnos y programas de su organización.
_Evitar_: administrador global como sinónimo de este rol dentro de una organización.

**Medida de registro**:
Magnitud que el planificador solicita registrar para un trabajo, con la unidad correspondiente cuando aplica, como peso, repeticiones, tiempo o distancia.
_Evitar_: resultado como sinónimo de la medida solicitada.

**Resultado**:
Dato que el alumno registra sobre el trabajo realizado según las medidas indicadas por el planificador.
_Evitar_: objetivo como sinónimo de resultado realizado.

**RM (repetición máxima)**:
Referencia de carga máxima para un ejercicio y una cantidad determinada de repeticiones; un 1RM corresponde a una repetición. En ejercicios comunes, es un registro personal del alumno que no cambia por pertenecer a distintas organizaciones.
_Evitar_: peso realizado como sinónimo de RM, porque un resultado no necesariamente representa un máximo.

**Ejercicio común**:
Ejercicio del catálogo compartido por las organizaciones, con una identidad común para planificar y asociar los RM personales de cada alumno.
_Evitar_: ejercicio del box como sinónimo de ejercicio común.

**Ejercicio propio**:
Ejercicio creado por una organización para cubrir una necesidad que no contempla el catálogo común.
_Evitar_: ejercicio común como sinónimo de ejercicio propio.

**Bloque**:
Parte de una sesión que organiza un trabajo con su propia estructura y medidas de registro, como calentamiento, fuerza o un circuito.
_Evitar_: sesión como sinónimo de bloque.
