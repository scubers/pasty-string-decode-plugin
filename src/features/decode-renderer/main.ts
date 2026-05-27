import { createApp } from "vue";
import { patchConsole, patchTextInputState } from "@pasty/plugin-sdk/dom";
import DecodeRendererApp from "./app.vue";
import "../../shared/base.css";

patchConsole();
patchTextInputState();
createApp(DecodeRendererApp).mount("#app");
