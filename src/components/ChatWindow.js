import React, { useState, useEffect, useRef } from "react";
import "./ChatWindow.css";
import { getAIMessage } from "../api/api";
import { marked } from "marked";
import ProductCard from "./ProductCard";

function ChatWindow() {

  const defaultMessage = [{
    role: "assistant",
    content: "Hi, how can I help you today?"
  }];

  const [messages, setMessages] = useState(defaultMessage);
  const [input, setInput] = useState("");
  const [awaitingQuestion, setAwaitingQuestion] = useState(null); // "product" | "transaction" after they chose 1 or 2

  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const sendMessage = async (userMessage, topicToSend) => {
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    const lower = userMessage.toLowerCase();
    if (lower === "1" || lower === "2") {
      if (lower === "1") setAwaitingQuestion("product");
      else setAwaitingQuestion("transaction");
    }
    const topic = topicToSend ?? awaitingQuestion;
    const history = topic === "product"
      ? messages.slice(-10).map((m) => ({ role: m.role, content: m.content || "" }))
      : [];
    const newMessage = await getAIMessage(userMessage, topic, history);
    setMessages((prev) => [...prev, newMessage]);
  };

  const handleSend = async () => {
    if (input.trim() === "") return;
    const userMessage = input.trim();
    setInput("");
    await sendMessage(userMessage, awaitingQuestion);
  };

  const handleAddPartToCart = async (partNumber) => {
    const text = `add ${partNumber} to cart`;
    await sendMessage(text, awaitingQuestion);
  };

  const handleQuickReply = (text) => {
    setInput("");
    sendMessage(text, awaitingQuestion);
  };

  const getQuickRepliesForMessage = (message, index) => {
    if (message.role !== "assistant" || !message.content) return null;
    const text = (message.content || "").trim();
    const lower = text.toLowerCase();
    if (index === 0 && message.role === "assistant") {
      return [
        { label: "Product Information", payload: "1" },
        { label: "Customer Transactions", payload: "2" }
      ];
    }
    if (lower.includes("your question") && lower.length < 30) {
      return [
        { label: "I need a part", payload: "I need a part" },
        { label: "Find my model number", payload: "How do I find my model number?" }
      ];
    }
    if (
      lower.includes("customer transactions") &&
      lower.includes("how can i help") &&
      lower.includes("add to cart") &&
      lower.includes("order status") &&
      !lower.includes("reply 1 for product")
    ) {
      return [
        { label: "Add to cart", payload: "add to cart" },
        { label: "Order status", payload: "order status" }
      ];
    }
    if (message.productOptions && message.productOptions.length > 0) {
      return message.productOptions.slice(0, 3).map((card, i) => ({
        label: `Add #${i + 1}: ${card.partNumber}`,
        payload: `add ${card.partNumber} to cart`
      }));
    }
    return null;
  };

  return (
      <div className="messages-container">
          {messages.map((message, index) => (
              <div key={index} className={`${message.role}-message-container`}>
                  {message.content && (
                      <div className={`message ${message.role}-message`}>
                          <div dangerouslySetInnerHTML={{__html: marked(message.content).replace(/<p>|<\/p>/g, "")}}></div>
                      </div>
                  )}
                  {message.productCard && (
                      <ProductCard
                          name={message.productCard.name}
                          partNumber={message.productCard.partNumber}
                          price={message.productCard.price}
                          addedToCart={message.productCard.addedToCart}
                      />
                  )}
                  {message.productOptions && message.productOptions.length > 0 && (
                      <div className="product-options">
                          {message.productOptions.map((card, i) => (
                              <ProductCard
                                  key={card.partNumber || i}
                                  name={card.name}
                                  partNumber={card.partNumber}
                                  price={card.price}
                                  addedToCart={card.addedToCart}
                                  onAddToCart={handleAddPartToCart}
                              />
                          ))}
                      </div>
                  )}
                  {(() => {
                    const chips = getQuickRepliesForMessage(message, index);
                    return chips && (
                      <div className="quick-replies">
                          {chips.map((qr, i) => (
                              <button
                                  key={i}
                                  type="button"
                                  className="quick-reply-chip"
                                  onClick={() => handleQuickReply(qr.payload)}
                              >
                                  {qr.label}
                              </button>
                          ))}
                      </div>
                    );
                  })()}
              </div>
          ))}
          <div ref={messagesEndRef} />
          <div className="input-area">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type a message..."
              onKeyPress={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  handleSend();
                  e.preventDefault(); 
                }
              }}
              rows="3"
            />
            <button className="send-button" onClick={handleSend}>
              Send
            </button>
          </div>
      </div>
);
}

export default ChatWindow;
