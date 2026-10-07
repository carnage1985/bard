// Board-Kern: SSE-Verbindung + Renderer-Registry. Jedes Spiel registriert einen Renderer
// (sh.js, ww.js) per registerRenderer(type, fn); der Server liefert view.type.
const $ = (id) => document.getElementById(id);
const renderers = {};
function registerRenderer(type, fn) { renderers[type] = fn; }

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

window.addEventListener('load', () => {
  const es = new EventSource('events');
  es.onmessage = (e) => {
    $('status').textContent = 'live';
    const view = JSON.parse(e.data);
    const render = renderers[view.type || 'secrethitler'];
    if (render) render(view);
  };
  es.onerror = () => { $('status').textContent = 'Verbindung unterbrochen – versuche erneut…'; };
});
