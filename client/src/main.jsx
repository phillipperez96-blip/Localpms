import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import App from './App.jsx';
import { AppProvider } from './lib/store.jsx';
import './index.css';

// A data router is used so pages can ask "are you sure you want to leave?" (useBlocker).
const router = createBrowserRouter([{ path: '*', element: <AppProvider><App /></AppProvider> }]);

createRoot(document.getElementById('root')).render(<RouterProvider router={router} />);
