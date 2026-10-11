import {
  consumePendingLookupQuery,
  installSapTabNavigation,
} from "./sapTabNavigation";
import { markResolvedBpLookup } from './documentBpSelection';

describe("SAP lookup Tab navigation", () => {
  let restoreClientRects;
  let cleanupNavigation;

  beforeEach(() => {
    const originalGetClientRects = HTMLElement.prototype.getClientRects;
    HTMLElement.prototype.getClientRects = function getClientRects() {
      return [{ width: 100, height: 20 }];
    };
    restoreClientRects = () => {
      HTMLElement.prototype.getClientRects = originalGetClientRects;
    };

    window.__sapB1TabNavigationInstalled = false;
    window.__sapB1PendingLookupQuery = "";
    cleanupNavigation = installSapTabNavigation();
  });

  afterEach(() => {
    cleanupNavigation?.();
    restoreClientRects?.();
    document.body.replaceChildren();
    delete window.__sapB1PendingLookupQuery;
  });

  test("opens a payment lookup with the value entered before Tab", () => {
    const wrapper = document.createElement("span");
    wrapper.className = "sap-lookup";
    const input = document.createElement("input");
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.sapLookupButton = "true";
    button.textContent = "...";
    wrapper.append(input, button);
    document.body.append(wrapper);

    const openLookup = jest.fn(() => consumePendingLookupQuery());
    button.addEventListener("click", openLookup);

    input.focus();
    input.value = "V20000";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    }));

    expect(openLookup).toHaveBeenCalledTimes(1);
    expect(openLookup).toHaveReturnedWith("V20000");
    expect(window.__sapB1PendingLookupQuery).toBe("");
  });

  test("normal Tab navigation does not reopen an unchanged resolved value", () => {
    const wrapper = document.createElement("span");
    wrapper.className = "sap-lookup";
    const input = document.createElement("input");
    input.value = "V20000";
    input.dataset.sapLookupResolvedValue = "V20000";
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.sapLookupButton = "true";
    wrapper.append(input, button);
    document.body.append(wrapper);

    const openLookup = jest.fn();
    button.addEventListener("click", openLookup);

    input.focus();
    input.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    }));

    expect(openLookup).not.toHaveBeenCalled();
  });

  test("ordinary matrix fields keep native Tab behavior", () => {
    const discount = document.createElement("input");
    discount.name = "stdDiscount";
    const country = document.createElement("select");
    country.name = "countryOfOrigin";
    document.body.append(discount, country);

    discount.focus();
    const tabEvent = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    const dispatched = discount.dispatchEvent(tabEvent);

    expect(dispatched).toBe(true);
    expect(tabEvent.defaultPrevented).toBe(false);
  });

  test("typed Header UDF lookup opens on Tab and carries the search text", () => {
    const wrapper = document.createElement("div");
    wrapper.className = "po-udf-lookup-control";
    const field = document.createElement("div");
    field.className = "po-udf-lookup-control__field";
    const input = document.createElement("input");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "...";
    field.append(input);
    wrapper.append(field, button);
    document.body.append(wrapper);
    const openLookup = jest.fn(() => consumePendingLookupQuery());
    button.addEventListener("click", openLookup);

    input.focus();
    input.value = "te";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const tabEvent = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    input.dispatchEvent(tabEvent);

    expect(tabEvent.defaultPrevented).toBe(true);
    expect(openLookup).toHaveReturnedWith("te");
  });

  test("empty lookup opens on Tab so the user can choose a value", () => {
    const wrapper = document.createElement("div");
    wrapper.className = "po-udf-lookup-control";
    const field = document.createElement("div");
    field.className = "po-udf-lookup-control__field";
    const input = document.createElement("input");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "...";
    field.append(input);
    wrapper.append(field, button);
    document.body.append(wrapper);
    const openLookup = jest.fn();
    button.addEventListener("click", openLookup);

    input.focus();
    const tabEvent = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    input.dispatchEvent(tabEvent);

    expect(tabEvent.defaultPrevented).toBe(true);
    expect(openLookup).toHaveBeenCalledTimes(1);
  });

  test('BP code Tab continues for a valid code and opens lookup for a name search', () => {
    const wrapper = document.createElement('span');
    wrapper.className = 'sap-input-group';
    const input = document.createElement('input');
    input.name = 'vendor';
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '...';
    wrapper.append(input, button);
    document.body.append(wrapper);
    const openLookup = jest.fn(() => consumePendingLookupQuery());
    button.addEventListener('click', openLookup);

    input.focus();
    input.value = 'OTHER123';
    markResolvedBpLookup(input, input.value, [{ CardCode: 'OTHER123' }], {
      preferredCardCode: 'CUS00938', excludedCardCodes: ['AC00350'],
    });
    let tabEvent = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    input.dispatchEvent(tabEvent);
    expect(tabEvent.defaultPrevented).toBe(false);
    expect(openLookup).not.toHaveBeenCalled();

    input.value = 'nature';
    markResolvedBpLookup(input, input.value, [{ CardCode: 'OTHER123' }], null);
    tabEvent = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    input.dispatchEvent(tabEvent);
    expect(tabEvent.defaultPrevented).toBe(true);
    expect(openLookup).toHaveReturnedWith('nature');
  });
});
