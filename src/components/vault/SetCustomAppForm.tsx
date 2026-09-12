import { useState } from "react";
import { Form, ActionPanel, Action, useNavigation, showToast, Toast, Icon } from "@raycast/api";
import { VaultItem, VaultAttachment } from "../../types/vault";

interface SetCustomAppFormProps {
  item: VaultItem;
  attachment: VaultAttachment;
  onSaved: (appPath: string | undefined) => Promise<void>;
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

export function SetCustomAppForm({ item, attachment, onSaved }: SetCustomAppFormProps) {
  const { pop } = useNavigation();

  const initialPreset = COMMON_APPS.find((a) => a.id === (attachment.customAppPath || ""))
    ? attachment.customAppPath || ""
    : attachment.customAppPath
      ? "__custom__"
      : "";

  const [selectedPreset, setSelectedPreset] = useState<string>(initialPreset);
  const [customPath, setCustomPath] = useState<string>(
    initialPreset === "__custom__" ? attachment.customAppPath || "" : "",
  );
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit() {
    setIsSaving(true);
    let chosenApp: string | undefined = undefined;

    if (selectedPreset === "__custom__") {
      chosenApp = customPath.trim() || undefined;
    } else if (selectedPreset) {
      chosenApp = selectedPreset.trim();
    }

    try {
      await onSaved(chosenApp);
      await showToast({
        style: Toast.Style.Success,
        title: "Opening App Updated",
        message: chosenApp ? `Configured to open in ${chosenApp}` : "Reset to Windows Default App",
      });
      pop();
    } catch (err) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to update app",
        message: String(err),
      });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Form
      isLoading={isSaving}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Save App Preference" icon={Icon.Check} onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.Description
        title={`Configure Opener for "${attachment.name}"`}
        text={`Item: "${item.title}"\nChoose which application should open this encrypted file when launched.`}
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

      <Form.Description text="When you open this file, Raycast will decrypt it to secure temporary storage and launch it directly in this app." />
    </Form>
  );
}
