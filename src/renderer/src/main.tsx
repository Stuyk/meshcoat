import { render } from 'solid-js/web'
import App from './App'
import './index.css'
import { installConsoleCapture } from './utils/logger'

installConsoleCapture()

const root = document.getElementById('root')

if (root) {
  render(() => <App />, root)
}
