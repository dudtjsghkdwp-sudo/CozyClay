import { ko } from "../locale.js";
import { FiCopy, FiFileText, FiPlay } from "react-icons/fi";
import { toast } from "react-hot-toast";
import { shotPromptTarget } from "./shot-prompt-node.js";

/**
 * Shot Prompt node (#166): reads the connected Scene node's capture metadata
 * (and an optional Text intent) and shows the structured prompt built by
 * src/shot-prompt.js, ready to copy or to feed an Image/Video node.
 *
 * NodeShell is injected by WorkflowBuilder so this file stays free of the
 * canvas' ReactFlow wiring.
 */
export default function ShotPromptNode({ id, data = {}, NodeShell }) {
	const target = shotPromptTarget(data.target);
	const referenceOwnsCamera = data.referenceOwnsCamera !== false;
	const prompt = typeof data.prompt === "string" ? data.prompt : "";
	const copy = async () => {
		if (!prompt) { toast.error("Run the node to build a prompt first"); return; }
		try { await navigator.clipboard.writeText(prompt); toast.success("Prompt copied"); }
		catch (error) { toast.error(`Could not copy the prompt (${error.message})`); }
	};
	return <NodeShell id={id} type="shot-prompt" title={ko("Shot Prompt", "샷 프롬프트")} icon={FiFileText}>
		<label htmlFor={`${id}-target`}>{ko("Target", "대상")}</label>
		<select id={`${id}-target`} aria-label={ko("Prompt target", "프롬프트 대상")} value={target} onChange={(event) => data.onChange?.(id, { target: event.target.value })}>
			<option value="image">{ko("Image", "이미지")}</option>
			<option value="video">{ko("Video", "영상")}</option>
		</select>
		<label className="workflow-schema-check"><input type="checkbox" aria-label={ko("Reference owns camera", "레퍼런스가 카메라를 결정")} checked={referenceOwnsCamera} onChange={(event) => data.onChange?.(id, { referenceOwnsCamera: event.target.checked })} />{ko("Reference owns camera", "레퍼런스가 카메라를 결정")}</label>
		<label htmlFor={`${id}-prompt`}>{ko("Prompt", "프롬프트")}</label>
		<textarea id={`${id}-prompt`} className="workflow-textarea workflow-shot-prompt-text" aria-label={ko("Shot prompt", "샷 프롬프트")} readOnly value={prompt} placeholder={ko("Connect a Scene node and run to build the prompt", "장면 노드를 연결하고 실행하면 프롬프트가 만들어져요")} />
		{data.errorMsg && <div className="workflow-error">{data.errorMsg}</div>}
		<button type="button" className="workflow-shot-prompt-copy" onClick={copy}><FiCopy size={11} /> {ko("Copy", "복사")}</button>
		<div className="workflow-node-foot"><span>{target === "video" ? "Video prompt" : "Image prompt"}</span><button className="workflow-mini-button" type="button" onClick={() => data.onRun?.(id)}><FiPlay size={12} /></button></div>
	</NodeShell>;
}
