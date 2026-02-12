import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Patch DOM methods to prevent crashes from browser extensions
// that modify React-managed DOM nodes (e.g. translation, Grammarly, ad blockers)
if (typeof Node !== 'undefined') {
  const originalRemoveChild = Node.prototype.removeChild;
  // @ts-ignore
  Node.prototype.removeChild = function <T extends Node>(child: T): T {
    if (child.parentNode !== this) {
      console.warn('removeChild: node is not a child of this node – suppressed');
      return child;
    }
    return originalRemoveChild.call(this, child) as T;
  };

  const originalInsertBefore = Node.prototype.insertBefore;
  // @ts-ignore
  Node.prototype.insertBefore = function <T extends Node>(newNode: T, refNode: Node | null): T {
    if (refNode && refNode.parentNode !== this) {
      console.warn('insertBefore: refNode is not a child of this node – suppressed');
      return newNode;
    }
    return originalInsertBefore.call(this, newNode, refNode) as T;
  };
}

createRoot(document.getElementById("root")!).render(<App />);
