// Generated plugin registry. Reviewed repository code only.
import run2 from "./research-plugin.mjs";
export const plugins = [
{manifest:{"apiVersion":1,"version":"1.0.0","role":"owner","settings":[],"workspace":"settings","id":"image-zoom","name":"Image zoom","description":"Enlarge article images in an accessible dialog.","scope":"site","runtime":"browser","appearanceKey":"imageZoom","operations":[]}},
{manifest:{"apiVersion":1,"version":"1.0.0","role":"owner","settings":[],"workspace":"settings","id":"reading-progress","name":"Reading progress","description":"Show reading progress on article pages.","scope":"site","runtime":"browser","appearanceKey":"readingProgress","operations":[]}},
{manifest:{"apiVersion":1,"version":"1.0.0","role":"owner","settings":[],"workspace":"research","id":"research","name":"Research","description":"Collect private source evidence, track changes and review facts before using them in an article.","scope":"private","runtime":"request","operations":["configure","refresh","propose"]},run:run2}
];
