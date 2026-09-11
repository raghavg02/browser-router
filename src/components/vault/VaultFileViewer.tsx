import { useState, useEffect } from "react";
import fs from "fs";
import path from "path";
import { Detail, ActionPanel, Action, Icon, showToast, Toast, Keyboard } from "@raycast/api";
import { VaultAttachment } from "../../types/vault";
import { getDecryptedAttachmentPath } from "../../utils/vaultStorage";

interface VaultFileViewerProps {
  attachment: VaultAttachment;
  vaultKey: Buffer;
}

export function VaultFileViewer({ attachment, vaultKey }: VaultFileViewerProps) {
  const [filePath, setFilePath] = useState<string | null>(null);
  const [zoomScale, setZoomScale] = useState<number>(100);
  const [isFit, setIsFit] = useState<boolean>(true);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const ext = path.extname(attachment.name).toLowerCase();
  const isImage = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".bmp"].includes(ext);
  const isText = [
    ".txt",
    ".md",
    ".json",
    ".csv",
    ".log",
    ".js",
    ".ts",
    ".tsx",
    ".jsx",
    ".html",
    ".css",
    ".py",
  ].includes(ext);
  const isPdf = ext === ".pdf";

  useEffect(() => {
    try {
      const decryptedPath = getDecryptedAttachmentPath(attachment, vaultKey);
      setFilePath(decryptedPath);

      if (decryptedPath && isText) {
        const text = fs.readFileSync(decryptedPath, "utf8");
        setTextContent(text);
      }
    } catch (e) {
      showToast({
        style: Toast.Style.Failure,
        title: "Failed to decrypt file",
        message: String(e),
      });
    } finally {
      setIsLoading(false);
    }
  }, [attachment]);

  function handleZoomIn() {
    setIsFit(false);
    setZoomScale((prev) => Math.min(prev + 25, 300));
  }

  function handleZoomOut() {
    setIsFit(false);
    setZoomScale((prev) => Math.max(prev - 25, 50));
  }

  function handleToggleFit() {
    setIsFit((prev) => !prev);
    if (!isFit) {
      setZoomScale(100);
    }
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  if (isLoading || !filePath) {
    return <Detail isLoading={true} markdown="Decrypting attachment in memory..." />;
  }

  let markdown = "";

  if (isImage) {
    // Raycast Detail Markdown image rendering
    // Width sizing based on zoomScale when not Fit
    const imgUri = `file:///${filePath.replace(/\\/g, "/")}`;
    markdown = `# ${attachment.name}

`;
    if (isFit) {
      markdown += `![${attachment.name}](${imgUri})`;
    } else {
      markdown += `<img src="${imgUri}" width="${zoomScale}%" alt="${attachment.name}" />`;
    }
    markdown += `

---
*Zoom: **${isFit ? "Fit Window" : `${zoomScale}%`}** — Use + / - to Zoom, Z to Toggle Fit.*
`;
  } else if (isText) {
    const codeLang = ext.replace(".", "") || "text";
    markdown = "# " + attachment.name + "\n\n" + "```" + codeLang + "\n" + (textContent || "") + "\n" + "```" + "\n";
  } else if (isPdf) {
    markdown =
      "# 📑 " +
      attachment.name +
      "\n\n" +
      "> [!NOTE]\n" +
      "> **PDF Document (" +
      formatSize(attachment.size) +
      ")**\n" +
      "> Decrypted securely in RAM. You can copy the decrypted file or open it in your system viewer using the Action Panel.\n\n" +
      "---\n" +
      "- **File Name:** " +
      "`" +
      attachment.name +
      "`" +
      "\n" +
      "- **File Size:** " +
      "`" +
      formatSize(attachment.size) +
      "`" +
      "\n" +
      "- **Added:** " +
      "`" +
      new Date(attachment.createdAt).toLocaleDateString() +
      "`" +
      "\n";
  } else {
    markdown =
      "# 📦 " +
      attachment.name +
      "\n\n" +
      "- **File Size:** " +
      "`" +
      formatSize(attachment.size) +
      "`" +
      "\n" +
      "- **File Type:** " +
      "`" +
      ext.toUpperCase() +
      " file" +
      "`" +
      "\n";
  }

  return (
    <Detail
      markdown={markdown}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label title="File Name" text={attachment.name} />
          <Detail.Metadata.Label title="File Size" text={formatSize(attachment.size)} />
          <Detail.Metadata.Label title="Format" text={ext.toUpperCase() || "File"} />
          {isImage ? (
            <>
              <Detail.Metadata.Separator />
              <Detail.Metadata.Label title="Zoom Scale" text={isFit ? "Fit Window" : `${zoomScale}%`} />
            </>
          ) : null}
          <Detail.Metadata.Separator />
          <Detail.Metadata.Label
            title="Added"
            text={new Date(attachment.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
          />
        </Detail.Metadata>
      }
      actions={
        <ActionPanel>
          {isImage ? (
            <ActionPanel.Section title="Zoom Controls">
              <Action
                title="Zoom in (+25%)"
                icon={Icon.MagnifyingGlass}
                shortcut={{ modifiers: [], key: "+" }}
                onAction={handleZoomIn}
              />
              <Action
                title="Zoom out (-25%)"
                icon={Icon.MagnifyingGlass}
                shortcut={{ modifiers: [], key: "-" }}
                onAction={handleZoomOut}
              />
              <Action
                title={isFit ? "Zoom: Actual Size (100%)" : "Zoom: Fit to Window"}
                icon={Icon.Maximize}
                shortcut={{ modifiers: [], key: "z" }}
                onAction={handleToggleFit}
              />
            </ActionPanel.Section>
          ) : null}

          {isText && textContent ? (
            <Action.CopyToClipboard
              title="Copy Document Text"
              content={textContent}
              shortcut={{ modifiers: ["ctrl"], key: "c" }}
            />
          ) : null}

          <Action.OpenWith
            path={filePath}
            title="Open in System App…"
            icon={Icon.ArrowNe}
            shortcut={Keyboard.Shortcut.Common.OpenWith}
          />
        </ActionPanel>
      }
    />
  );
}
