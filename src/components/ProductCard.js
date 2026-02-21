import React from "react";
import "./ProductCard.css";

/**
 * Reusable product card for flow 1 (Product) and flow 2 (Transactions).
 * Shows name, part number, price; optional "Added to cart" badge or quick action "Add to cart" button.
 */
function ProductCard({ name, partNumber, price, addedToCart, onAddToCart }) {
  const displayPrice = typeof price === "number" ? `$${price.toFixed(2)}` : price;
  return (
    <div className="product-card">
      <div className="product-card__body">
        <div className="product-card__name">{name}</div>
        <div className="product-card__meta">
          <span className="product-card__part">Part # {partNumber}</span>
          <span className="product-card__price">{displayPrice}</span>
        </div>
        {addedToCart ? (
          <span className="product-card__badge product-card__badge--cart">Added to cart</span>
        ) : onAddToCart ? (
          <button type="button" className="product-card__action" onClick={() => onAddToCart(partNumber)}>
            Add to cart
          </button>
        ) : (
          <span className="product-card__badge product-card__badge--confirm">Is this the right product?</span>
        )}
      </div>
    </div>
  );
}

export default ProductCard;
