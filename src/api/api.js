
export const getAIMessage = async (userQuery, topic = null, history = []) => {
  try {
    const body = { message: userQuery, topic };
    if (topic === "product" && Array.isArray(history) && history.length > 0) {
      body.history = history;
    }
    const res = await fetch("http://localhost:3001/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    
    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }
    
    const data = await res.json();
    return {
      role: "assistant",
      content: data.reply || data.content || "No response",
      ...(data.productCard != null && { productCard: data.productCard }),
      ...(data.productOptions != null && { productOptions: data.productOptions })
    };
  } catch (error) {
    console.error("API Error:", error);
    return {
      role: "assistant",
      content: `Error: Could not connect to server. Make sure the backend is running on port 3001. ${error.message}`
    };
  }
};
