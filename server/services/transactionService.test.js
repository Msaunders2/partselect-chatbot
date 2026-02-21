/**
 * Tests for transactionService: add-to-cart stub + secure order lookup.
 * Run: node server/services/transactionService.test.js
 */
const { describe, it } = require("node:test");
const assert = require("node:assert");
const {
  handleTransaction,
  getAddToCartIntent,
  MOCK_ORDERS
} = require("./transactionService");

describe("getAddToCartIntent", () => {
  it("detects 'add to cart'", () => {
    const r = getAddToCartIntent("add to cart");
    assert.strictEqual(r.intent, true);
    assert.strictEqual(r.itemName, null);
  });

  it("detects 'add [item] to cart'", () => {
    const r = getAddToCartIntent("add dishwasher pump to cart");
    assert.strictEqual(r.intent, true);
    assert.strictEqual(r.itemName, "dishwasher pump");
  });

  it("detects 'add to basket'", () => {
    const r = getAddToCartIntent("add to basket");
    assert.strictEqual(r.intent, true);
  });

  it("detects 'add this to cart'", () => {
    const r = getAddToCartIntent("add this to cart");
    assert.strictEqual(r.intent, true);
  });

  it("detects 'add a X to my cart' and extracts item", () => {
    const r = getAddToCartIntent("add a whirlpool pool part to my cart");
    assert.strictEqual(r.intent, true);
    assert.strictEqual(r.itemName, "a whirlpool pool part");
  });

  it("detects 'add the X' without cart word", () => {
    const r = getAddToCartIntent("add the whirlpool dishwasher part");
    assert.strictEqual(r.intent, true);
    assert.strictEqual(r.itemName, "whirlpool dishwasher part");
  });

  it("detects 'X Part # PS123 to my cart' as add-to-cart and extracts part number", () => {
    const r = getAddToCartIntent("yes Thermostat Parts Washer Part # PS10010096 to my cart");
    assert.strictEqual(r.intent, true);
    assert.strictEqual(r.partNumber, "PS10010096");
  });

  it("detects 'add PS123 to cart' and extracts part number", () => {
    const r = getAddToCartIntent("add PS3406971 to cart");
    assert.strictEqual(r.intent, true);
    assert.strictEqual(r.partNumber, "PS3406971");
  });

  it("detects 'looking for part number PS10065979' as add-to-cart with part number", () => {
    const r = getAddToCartIntent("looking for part number PS10065979");
    assert.strictEqual(r.intent, true);
    assert.strictEqual(r.partNumber, "PS10065979");
  });

  it("detects 'I need a lower rack for my dishwasher' and extracts item name", () => {
    const r = getAddToCartIntent("I need a lower rack for my dishwasher");
    assert.strictEqual(r.intent, true);
    assert.ok(r.itemName && r.itemName.includes("lower rack") && r.itemName.includes("dishwasher"));
  });

  it("returns false for non-cart messages", () => {
    assert.strictEqual(getAddToCartIntent("what is the price?").intent, false);
    assert.strictEqual(getAddToCartIntent("PS-10001").intent, false);
    assert.strictEqual(getAddToCartIntent("order status").intent, false);
  });
});

describe("handleTransaction - add-to-cart stub", () => {
  it("add-to-cart includes Part # and price (single match) or offers options (multiple matches)", () => {
    const result = handleTransaction("add dryer belt to cart");
    const { reply, productCard, productOptions } = result;
    assert.ok(reply);
    if (productCard) {
      assert.match(reply, /added to your cart/);
      assert.match(reply, /Part #PS-\d+/);
      assert.match(reply, /\$\d+\.\d{2}/);
      assert.ok(productCard.name && productCard.partNumber && (typeof productCard.price === "number" || typeof productCard.price === "string") && productCard.addedToCart === true);
    } else {
      assert.ok(productOptions && productOptions.length > 0, "expected productCard or productOptions");
      assert.match(reply, /matching parts|Do you mean/);
      const first = productOptions[0];
      assert.ok(first.name && first.partNumber && (typeof first.price === "number" || typeof first.price === "string"));
    }
  });

  it("add-to-cart without item name uses 'This item' and PS-DEMO", () => {
    const { reply, productCard } = handleTransaction("add to cart");
    assert.match(reply, /This item/);
    assert.match(reply, /Part #PS-DEMO/);
    assert.match(reply, /\$0\.00/);
    assert.ok(productCard && productCard.addedToCart && productCard.partNumber === "PS-DEMO");
  });

  it("add by part number returns single product when part exists", () => {
    const result = handleTransaction("add PS3406971 to cart");
    assert.ok(result.productCard, "expected productCard when adding by part number");
    assert.strictEqual(result.productCard.partNumber, "PS3406971");
    assert.strictEqual(result.productCard.addedToCart, true);
  });

  it("same item name yields same part number and price (when single match)", () => {
    const r1 = handleTransaction("add dishwasher pump to cart");
    const r2 = handleTransaction("add dishwasher pump to cart");
    const part1 = r1.reply.match(/Part #(PS-\d+)/)?.[1];
    const part2 = r2.reply.match(/Part #(PS-\d+)/)?.[1];
    const price1 = r1.reply.match(/\$(\d+\.\d{2})/)?.[1];
    const price2 = r2.reply.match(/\$(\d+\.\d{2})/)?.[1];
    if (r1.productCard && r2.productCard) {
      assert.strictEqual(part1, part2);
      assert.strictEqual(price1, price2);
    }
    // If productOptions, both replies should be the same disambiguation message
    if (r1.productOptions && r2.productOptions) {
      assert.ok(r1.productOptions.length > 0 && r2.productOptions.length > 0);
    }
  });
});

describe("handleTransaction - order lookup", () => {
  it("finds order by PS-10001", () => {
    const { reply } = handleTransaction("PS-10001");
    assert.match(reply, /Order PS-10001/);
    assert.match(reply, /Shipped/);
    assert.match(reply, /Dishwasher pump motor/);
    assert.match(reply, /UPS/);
    assert.match(reply, /1Z999AA10123456784/);
  });

  it("finds order by numeric id 10001", () => {
    const { reply } = handleTransaction("10001");
    assert.match(reply, /Order PS-10001/);
  });

  it("finds order by email", () => {
    const { reply } = handleTransaction("customer@example.com");
    assert.match(reply, /Order PS-10001/);
  });

  it("PS-10002 shows Processing and no tracking", () => {
    const { reply } = handleTransaction("PS-10002");
    assert.match(reply, /Processing/);
    assert.match(reply, /Refrigerator water filter/);
    assert.match(reply, /Tracking will be available once/);
  });

  it("PS-10003 shows Delivered and USPS tracking", () => {
    const { reply } = handleTransaction("PS-10003");
    assert.match(reply, /Delivered/);
    assert.match(reply, /USPS/);
  });

  it("order reply includes security wording", () => {
    const { reply } = handleTransaction("PS-10001");
    assert.match(reply, /order number or email/);
  });

  it("finds order when id is inside a sentence (track my order PS-10001)", () => {
    const { reply } = handleTransaction("can I track my order PS-10001");
    assert.match(reply, /Order PS-10001/);
    assert.match(reply, /Shipped/);
  });

  it("finds order when email is inside a sentence", () => {
    const { reply } = handleTransaction("my email is customer@example.com");
    assert.match(reply, /Order PS-10001/);
  });

  it("returns clear 'no order found' for unknown order id in message", () => {
    const { reply } = handleTransaction("can I track my order PS-1000");
    assert.match(reply, /No order found/);
    assert.match(reply, /PS-1000/);
    assert.match(reply, /PS-10001|demo/);
  });

  it("returns clear 'no order found' for unknown email", () => {
    const { reply } = handleTransaction("marionnn@gmail.com");
    assert.match(reply, /No order found/);
    assert.match(reply, /marionnn@|email/);
    assert.match(reply, /customer@example.com|demo/);
  });
});

describe("handleTransaction - order status prompt", () => {
  it("asks for order number or email when user says 'order status'", () => {
    const { reply } = handleTransaction("order status");
    assert.match(reply, /order number|email/);
    assert.match(reply, /PS-10001/);
    assert.match(reply, /security|verify/);
  });

  it("asks for order number when user says 'track order'", () => {
    const { reply } = handleTransaction("track order");
    assert.match(reply, /order number|email/);
  });
});

describe("handleTransaction - fallback", () => {
  it("empty message returns help", () => {
    const { reply } = handleTransaction("");
    assert.match(reply, /add parts to cart|order status/);
  });

  it("hello/hi in transaction offers friendly switch to 1 or 2", () => {
    const { reply: r1 } = handleTransaction("hello");
    const { reply: r2 } = handleTransaction("hi");
    assert.match(r1, /reply 1|Product Information/);
    assert.match(r1, /reply 2|Customer Transactions/);
    assert.match(r2, /reply 1|Product Information/);
  });

  it("unknown input suggests order number or add to cart", () => {
    const { reply } = handleTransaction("xyz random");
    assert.match(reply, /order number|add parts to cart|reply 1/);
  });
});

describe("MOCK_ORDERS", () => {
  it("has expected structure and at least 3 orders", () => {
    assert.ok(Array.isArray(MOCK_ORDERS));
    assert.ok(MOCK_ORDERS.length >= 3);
    MOCK_ORDERS.forEach((o) => {
      assert.ok(o.orderId);
      assert.ok(o.email);
      assert.ok(o.status);
      assert.ok(Array.isArray(o.items));
      assert.ok(o.placedAt);
    });
  });
});
