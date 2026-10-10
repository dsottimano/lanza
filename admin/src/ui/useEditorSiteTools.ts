import { onMounted, onUnmounted } from "vue";
import { editorSiteTools, type EditorSiteTools } from "../backend/editor-site-tools";
import { registerSiteTools } from "../backend/site-tools";

export function useEditorSiteTools(editor: EditorSiteTools) {
  let active = true;
  let dispose = () => {};
  onMounted(() => {
    dispose = registerSiteTools(editorSiteTools({ ...editor, ready: () => active && editor.ready() }));
  });
  onUnmounted(() => { active = false; dispose(); });
}
