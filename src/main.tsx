// js_cols global is set up in index.html before this module loads
import 'js_cols';

import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <App />
)


