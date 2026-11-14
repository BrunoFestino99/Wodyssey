# Flutter móvil, React web y backend compartido

Wodyssey tendrá aplicaciones Android e iOS con Flutter y Dart, una web con React y TypeScript, y un backend compartido con NestJS y TypeScript sobre PostgreSQL. Se elige Flutter por su adecuación a la experiencia móvil y el conocimiento previo del responsable del proyecto, manteniendo una interfaz web específica para la planificación en escritorio.

Se consideraron React Native, Flutter también para web y aplicaciones nativas separadas. La decisión prioriza una base móvil compartida y una web adaptada a su plataforma, aceptando mantener interfaces en Dart y TypeScript; no se presume que los componentes o las reglas ejecutables se puedan compartir entre ambos lenguajes.

El backend se organizará como una aplicación modular y concentrará la autorización y las reglas de negocio que requieren autoridad del servidor. Ambos clientes deberán respetar los mismos contratos y las reglas de sincronización, incluyendo el registro sin conexión y la protección de bloques iniciados. Las bibliotecas de almacenamiento local, el mecanismo de sincronización y el despliegue quedan pendientes de definición.
