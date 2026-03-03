import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import Aiinterview from './Aiinterview';
import InterviewProctor from './Interviewproctor';
import reportWebVitals from './reportWebVitals';

function App() {
  const [phase, setPhase] = useState("proctor");

  if (phase === "proctor") {
    return <InterviewProctor onComplete={() => setPhase("interview")} />;
  }

  return <Aiinterview />;
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

reportWebVitals();