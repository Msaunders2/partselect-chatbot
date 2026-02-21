import React from "react";
import "./App.css";
import ChatWindow from "./components/ChatWindow";

function App() {
  return (
    <div className="App">
      <header className="app-header">
        <img src="/partselect-logo.png" alt="PartSelect" className="app-header__logo" />
        <div className="app-header__brand">
          <span className="app-header__title">PartSelect</span>
          <span className="app-header__tagline">Here to help since 1999</span>
        </div>
      </header>
      <ChatWindow />
    </div>
  );
}

export default App;
