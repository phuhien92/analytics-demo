/**
 * Written by `shadcn init`, and kept because `components.json` names it as the `utils`
 * alias — the next `shadcn add` writes components that import `cn` from here.
 *
 * The three components this screen earned import `cn` from the `cn` package directly,
 * which is what the 4.x registry emits, so nothing in the repository reads this file
 * today. Deleting it would work until the next component is added and then fail at that
 * component's import, which is a worse trade than one re-export.
 */
export { cn } from "cn";
