---
title: Arquitectura
description: >-
  Cada pieza con su nombre: qué se ejecuta dónde, quién guarda qué secreto y por cuánto tiempo, cómo
  funciona de verdad el inicio de sesión y qué puede tocar un agente.
draft: false
template: landing
preset: architecture
slots:
  tag: ARQUITECTURA · LA MÁQUINA COMPLETA
  headline: Cada pieza, con su nombre.
  sub: >-
    Cómo funciona cuenta la historia de un cambio. Esto es el cableado que hay detrás: qué es cada
    pieza, quién la opera, qué secretos guarda y cuánto duran. Nada aquí es el diagrama de un ideal.
    Es lo que hace el código, y donde el código hacía algo peor, lo dice.
  partsEyebrow: Las piezas
  partsHead: Seis piezas. Cinco son suyas.
  partsIntro: >-
    En esta lista no hay ningún servidor de aplicaciones. Su sitio se compila a archivos por
    adelantado, y lo único que ocurre al recibir una visita es que Cloudflare entrega uno. La única
    pieza que operamos nosotros no interviene en nada de lo que usted haga después del primer día.
  partsCols:
    - text: Pieza
    - text: Qué es en realidad
    - text: Quién la opera
    - text: Guarda secretos
  parts:
    - name: Su repositorio
      what: Archivos Markdown y HTML en GitHub. La fuente de la verdad de cada palabra de su sitio.
      who: Usted
      secrets: 'No'
    - name: Su sitio
      what: >-
        Un build estático de Astro, servido por Cloudflare Pages. HTML puro cuando llega al
        visitante.
      who: Usted
      secrets: 'No'
    - name: Lanza, el CMS
      what: Una aplicación Vue en /admin. Archivos estáticos, sin backend propio.
      who: Usted
      secrets: 'No'
    - name: lanza-site
      what: El paquete npm con el código de render y las funciones del sitio. Usted fija la versión.
      who: Usted
      secrets: 'No'
    - name: El intermediario
      what: >-
        connect.lanzacms.com. Crea su repositorio y su proyecto de Pages durante el alta, y después
        no vuelve a tener nada que ver con su sitio.
      who: Lanza
      secrets: Dos, solo para el alta
    - name: /api/mcp
      what: El punto de conexión al que se conecta un agente de IA para editar su sitio.
      who: Usted
      secrets: 'No'
  editEyebrow: La vida de un cambio
  editHead: Guardar escribe en una rama. Publicar es una fusión.
  editIntro: >-
    El CMS nunca escribe en su sitio en vivo. Escribe en una rama de preparación, y publicar es una
    fusión de git corriente, y por eso todo cambio es reversible y nada queda aplicado a medias.
  editSteps:
    - t: Usted guarda
      c: PUT → staging
      b: >-
        El CMS hace commit en la rama staging a través de su propio proxy /admin/api/gh. Su
        navegador nunca tiene el token de GitHub: vive en una cookie que JavaScript no puede leer, y
        el proxy lo adjunta en el servidor, comprobando en cada petición que el endpoint es uno de
        los que el CMS puede llamar y que la URL resuelta sigue apuntando a su repositorio y a
        ningún otro.
    - t: Usted revisa
      c: staging.<proyecto>.pages.dev
      b: >-
        Cloudflare también construye la rama de preparación, así que existe una URL real que muestra
        exactamente lo que acaba de escribir, antes de que nadie más pueda verlo.
    - t: Usted publica
      c: merge staging → main
      b: >-
        Una fusión. Sin paso de despliegue aparte y sin ninguna copia de su contenido viviendo en
        otro sitio.
    - t: Cloudflare reconstruye
      c: astro build → dist
      b: >-
        El push a main dispara un build estático. Las entradas marcadas como borrador no se
        renderizan, se hayan fusionado o no.
    - t: Usted cambia de opinión
      c: git revert
      b: >-
        Cada versión es un commit. Revertir es la misma operación que usaría un programador, y el
        CMS guarda el historial de temas por la misma razón.
  authEyebrow: Iniciar sesión
  authHead: No hay ningún secreto. En ninguna parte.
  authIntro: >-
    Iniciar sesión es el flujo de dispositivo de GitHub, el que se diseñó para televisores y
    terminales: necesita un identificador de cliente público y nada más. Su sitio no guarda ninguna
    clave de firma, ningún secreto de cliente y ninguna contraseña, porque en ningún momento el
    diseño pide una.
  authSteps:
    - text: >-
        Usted abre /admin. Le muestra un código corto y le envía a github.com a aprobarlo. No hay
        redirección, así que no hay ninguna URL de retorno que se pueda equivocar ni ningún token en
        una URL que se pueda filtrar.
    - text: >-
        Su navegador cambia esa aprobación por un token de GitHub, que se guarda en una cookie
        HttpOnly. El código de dispositivo nunca llega a la página; el token nunca llega a
        JavaScript.
    - text: 'En cada petición, la puerta le pregunta a GitHub quién es usted: GET /user.'
    - text: >-
        Por separado, en la misma petición, le pregunta a GitHub qué puede hacer aquí: GET
        /repos/owner/name, y lee el objeto de permisos que GitHub devuelve.
    - text: >-
        Admin se convierte en propietario, push en editor, pull en lector. La respuesta se guarda
        sesenta segundos y ni uno más.
    - text: >-
        El token dura ocho horas y se renueva en silencio durante ciento ochenta y cuatro días, así
        que usted teclea un código una vez por navegador y prácticamente nunca más.
  authCalloutHead: Por qué el rol es una pregunta y no una lista
  authCalloutBody: >-
    Antes había en su repositorio una lista de usuarios que decía quién podía editar. Ya no existe,
    y vale la pena decir por qué: una lista nuestra es una segunda respuesta a una pregunta que
    GitHub ya responde, y era la respuesta más débil. Podía contradecir a quien de verdad puede
    escribir en el repositorio, solo surtía efecto tras publicar y reconstruir, y quitar a alguien
    de ella no le quitaba el acceso. Preguntarle a GitHub cuesta una petición en caché y es correcto
    por construcción. Quite a un colaborador y queda fuera en menos de un minuto.
  keysEyebrow: Radio de impacto
  keysHead: Todo es una credencial suya, o no hay nada.
  keysIntro: >-
    La pregunta útil sobre una credencial no es si está cifrada. Es hasta dónde llega quien la
    tenga, durante cuánto tiempo y quién puede quitársela.
  keysCols:
    - text: Credencial
    - text: Hasta dónde llega
    - text: Duración
  keys:
    - cred: Su cookie de inicio de sesión
      reaches: >-
        Su token de GitHub, para sus repositorios. HttpOnly, Secure y limitada a /admin para no
        viajar nunca en una página pública
      life: 8 horas, renovada
    - cred: Su token de agente
      reaches: Lo mismo, para un agente al que usted se lo entrega. Se revoca con un clic en GitHub
      life: hasta que lo revoque
    - cred: El material de clave de su propio sitio
      reaches: Nada. No hay ninguno
      life: ninguna
    - cred: Lo que el intermediario guarda sobre su sitio
      reaches: Nada. Ni clave, ni token, ni registro
      life: ninguna
    - cred: Lo que nosotros podríamos desplegar en su sitio
      reaches: Nada. No existe ninguna credencial que nos lo permita
      life: ninguna
  agentEyebrow: Para agentes
  agentHead: Un agente edita su sitio como usted, con su credencial.
  agentBody: >-
    Su sitio expone un punto de conexión MCP. La credencial que acepta es un token de GitHub que
    usted mismo autoriza, desde Ajustes, y pega en su agente junto con la URL del endpoint. El sitio
    lo valida haciéndole a GitHub las mismas dos preguntas que hace cuando usted inicia sesión, así
    que un agente nunca puede hacer más que usted, y encima las herramientas están acotadas:
    escribir una entrada tiene que ser un archivo markdown dentro de una carpeta que declare uno de
    sus tipos de contenido. Antes esto era una ventana de OAuth de un solo clic, y la quitamos. Ese
    flujo exigía que nosotros operásemos un servidor de autorización capaz de emitir una credencial
    para su sitio, que es justo el poder que esta versión existe para eliminar. Un pegado, y nadie
    tiene una llave de su sitio salvo usted.
  agentLink: Leer el contrato para agentes
  costEyebrow: Lo que cuesta mantenerlo
  costHead: Los sitios estáticos son baratos porque no hay nada ejecutándose.
  costBody: >-
    Las vistas de página en Cloudflare Pages no se miden, así que no hay coste por visita ni un
    nivel de tráfico a partir del cual su factura empiece a moverse. No hay base de datos que pagar
    ni servidor ocioso, porque no hay servidor. El único coste recurrente es su dominio, que compra
    a quien quiera y apunta a donde quiera.
  costTiles:
    - value: $0
      label: por construir, alojar y servir
    - value: ~$12
      label: al año por un dominio, la única factura
    - value: '0'
      label: bases de datos, servidores y cosas que parchear
  sovEyebrow: La línea que trazamos
  sovHead: Una vez instalado, no podemos llegar a su sitio.
  sovIntro: >-
    Esta es la afirmación que merece comprobarse, así que aquí está lo que significa exactamente y
    lo que costó volverla cierta.
  sovBeforeLabel: Antes
  sovAfterLabel: Después
  sovBefore: >-
    Hasta agosto de 2026, nuestro servicio de alta guardaba la clave privada de una aplicación de
    GitHub. Esa clave podía emitir un token de escritura para todos los repositorios donde la
    aplicación estuviera instalada, es decir, todos los sitios de nuestros clientes. Y escribir en
    un repositorio no es poca cosa en un alojamiento estático: Cloudflare reconstruye desde su
    repositorio en cada push, así que quien controla su archivo de build controla lo que se sirve a
    sus visitantes. Un servicio comprometido, todos los sitios.
  sovAfter: >-
    Esa clave está eliminada, junto con todo lo que la usaba. Nuestro servicio guarda ahora dos
    secretos de cliente de OAuth, ambos inútiles sin una persona pulsando aprobar, y ninguno de los
    dos toca un sitio que ya existe.
  sovRows:
    - what: Una clave privada capaz de escribir en todos los repositorios de clientes
      state: Eliminada
    - what: Una clave de firma capaz de falsificar un acceso a cualquier sitio
      state: Eliminada
    - what: Un endpoint que cambiaba una firma por un token de repositorio
      state: Eliminado
    - what: La capacidad de meter una corrección en su repositorio sin preguntar
      state: Eliminada
    - what: Un servidor de autorización capaz de emitir una credencial de agente para su sitio
      state: Eliminado
  sovHonestHead: Lo que sigue siendo cierto
  sovHonestBody: >-
    La aplicación de GitHub sigue instalada en su repositorio, porque esa instalación es lo que
    permite que su propio inicio de sesión llegue hasta él. Quien administre esa aplicación puede
    generar una clave nueva. Así que la afirmación honesta no es que el riesgo sea cero: es que
    llegar a su sitio exige ahora comprometer la cuenta de GitHub de una persona, y no un servicio
    web en marcha. Ese objetivo es mucho más pequeño y mucho más lento, y usted puede cerrarlo del
    todo quitando la aplicación de su repositorio, lo que corta de golpe todos los tokens de su
    sitio.
  ownEyebrow: Actualizaciones, y marcharse
  ownHead: Usted fija la versión. Usted se queda los archivos.
  ownBody: >-
    Su sitio depende de un paquete publicado en la versión que usted elija, así que una mejora que
    publiquemos no cambia su sitio hasta que usted la tome, desde Ajustes, cuando le convenga. Antes
    podíamos meter una corrección crítica en su repositorio sin preguntar. Eso desapareció con todo
    lo demás, y lo que ocupa su lugar es un build que se niega a desplegar una versión marcada como
    insegura: su sitio en vivo sigue funcionando, no sale nada nuevo, y se le dice exactamente qué
    cambiar. Más lento, y con su mano encima. La salida nunca fue una función que tuviéramos que
    construir, porque su contenido ya es una carpeta de archivos corrientes en un repositorio suyo,
    y el paquete es público.
  ctaHead: Lea la versión en lenguaje llano.
  ctaSub: La misma máquina, contada como historia en vez de como diagrama.
  cta: Cómo funciona
  agentUrl: /es/agents/
  ctaUrl: /es/how-it-works/
---
