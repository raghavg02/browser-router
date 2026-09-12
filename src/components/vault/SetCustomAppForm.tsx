import { useState } from "react";
import { Form, ActionPanel, Action, useNavigation, showToast, Toast, Icon } from "@raycast/api";
import { VaultItem, VaultAttachment } from "../../types/vault";

interface SetCustomAppFormProps {
  item: VaultItem;
  attachment: VaultAttachment;
  mode?: "set_default" | "open_once";
  vaultKey?: Buffer;
  onSaved?: (appPath: string | undefined) => Promise<void>;
  onOpenOnce?: (appPath: string | undefined) => Promise<void>;
}

const COMMON_APPS = [
  { id: "", title: "Windows Default App" },
  { id: "mspaint.exe", title: "Paint (mspaint.exe)" },
  { id: "notepad.exe", title: "Notepad (notepad.exe)" },
  { id: "code.cmd", title: "Visual Studio Code (code.cmd)" },
  { id: "vlc.exe", title: "VLC Media Player (vlc.exe)" },
  { id: "msedge.exe", title: "Microsoft Edge (msedge.exe)" },
  { id: "chrome.exe", title: "Google Chrome (chrome.exe)" },
  { id: "__custom__", title: "Custom Executable Path…" },
];

export function SetCustomAppForm({
  item,
  attachment,
  mode = "set_default",
  onSaved,
  onOpenOnce,
}: SetCustomAppFormProps) {
  const { pop } = useNavigation();

  const isOneTime = mode === "open_once";

  const initialPreset = COMMON_APPS.find((a) => a.id === (attachment.customAppPath || ""))
    ? attachment.customAppPath || ""
    : attachment.customAppPath
      ? "__custom__"
      : "";

  const [selectedPreset, setSelectedPreset] = useState<string>(initialPreset);
  const [customPath, setCustomPath] = useState<string>(
    initialPreset === "__custom__" ? attachment.customAppPath || "" : "",
  );
  const [isProcessing, setIsProcessing] = useState(false);

  async function handleSubmit() {
    setIsProcessing(true);
    let chosenApp: string | undefined = undefined;

    if (selectedPreset === "__custom__") {
      chosenApp = customPath.trim() || undefined;
    } else if (selectedPreset) {
      chosenApp = selectedPreset.trim();
    }

    try {
      if (isOneTime) {
        if (onOpenOnce) {
          await onOpenOnce(chosenApp);
        }
        pop();
      } else {
        if (onSaved) {
          await onSaved(chosenApp);
        }
        await showToast({
          style: Toast.Style.Success,
          title: "Opening App Updated",
          message: chosenApp ? `Configured to open in ${chosenApp}` : "Reset to Windows Default App",
        });
        pop();
      }
    } catch (err) {
      await showToast({
        style: Toast.Style.Failure,
        title: isOneTime ? "Failed to open file" : "Failed to update app",
        message: String(err),
      });
    } finally {
      setIsProcessing(false);
    }
  }

  return (
    <Form
      isLoading={isProcessing}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title={isOneTime ? "Open File with Selected App" : "Save App Preference"}
            icon={isOneTime ? Icon.ArrowRight : Icon.Check}
            onSubmit={handleSubmit}
          />
        </ActionPanel>
      }
    >
      <Form.Description
        title={isOneTime ? `Open "${attachment.name}" with… (One Time)` : `Configure Opener for "${attachment.name}"`}
        text={
          isOneTime
            ? `Choose an application to open this file right now. This will NOT change your saved default application.`
            : `Item: "${item.title}"\nChoose which application should open this encrypted file by default every time you press Enter.`
        }
      />

      <Form.Dropdown
        id="preset"
        title="Application"
        value={selectedPreset}
        onChange={(val) => {
          setSelectedPreset(val);
          if (val !== "__custom__") {
            setCustomPath("");
          }
        }}
      >
        {COMMON_APPS.map((app) => (
          <Form.Dropdown.Item key={app.id} value={app.id} title={app.title} />
        ))}
      </Form.Dropdown>

      {selectedPreset === "__custom__" ? (
        <Form.TextField
          id="customApp"
          title="Executable Path or Command"
          placeholder="e.g. C:\\Program Files\\App\\app.exe or executable name"
          value={customPath}
          onChange={setCustomPath}
        />
      ) : null}

      <Form.Description
        text={
          isOneTime
            ? "Raycast will decrypt this file to temporary storage and launch it immediately in your chosen application."
            : "When you press Enter on this item, Raycast will decrypt it and launch it directly in this app."
        }
      />
    </Form>
  );
}
