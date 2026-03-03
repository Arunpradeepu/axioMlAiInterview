import { useState } from "react";
import Aiinterview from './Aiinterview';
import InterviewProctor from './Interviewproctor';

export default function App() {
  const [phase, setPhase] = useState("proctor"); // "proctor" | "interview"

  if (phase === "proctor") {
    return <InterviewProctor onComplete={() => setPhase("interview")} />;
  }

  return <AIInterview />;
}