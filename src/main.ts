import { Engine } from './core/Engine';

const style = document.createElement('style');
style.textContent = `
  *, *::before, *::after {
    box-sizing: border-box;
  }
  html, body, #app {
    margin: 0;
    padding: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: #09101d;
    font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  }
  .moba-ui-interactive {
    pointer-events: auto;
    user-select: none;
    -webkit-user-select: none;
  }
  .moba-ui-interactive::-webkit-scrollbar,
  .moba-ui-interactive *::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }
  .moba-ui-interactive::-webkit-scrollbar-track,
  .moba-ui-interactive *::-webkit-scrollbar-track {
    background: rgba(15, 23, 42, 0.6);
    border-radius: 4px;
  }
  .moba-ui-interactive::-webkit-scrollbar-thumb,
  .moba-ui-interactive *::-webkit-scrollbar-thumb {
    background: rgba(56, 189, 248, 0.45);
    border-radius: 4px;
  }
`;
document.head.appendChild(style);

const app = document.getElementById('app') ?? document.body;
const engine = new Engine(app);

// Expose clean debug hook on window for inspection without interfering with gameplay
(window as unknown as { __MOBA_ENGINE__?: Engine }).__MOBA_ENGINE__ = engine;
