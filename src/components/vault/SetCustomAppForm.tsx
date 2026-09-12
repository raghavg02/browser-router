import { useState, useMemo } from "react";
import { Form, ActionPanel, Action, useNavigation, showToast, Toast, Icon } from "@raycast/api";
import { VaultItem, VaultAttachment } from "../../types/vault";
import { getSuggestedAppsForFile, browseExecutableOnWindows, getFileCategory } from "../../utils/vaultAppHelper";

interface SetCustomAppFormProps {
  item: VaultItem;
  attachment: VaultAttachment;
  mode?: "set_default" | "open_once";
  vaultKey?: Buffer;
  onSaved?: (appPath: string | undefined) => Promise<void>;
  onOpenOnce?: (appPath: string | undefined) => Promise<void>;
}

export function SetCustomAppForm({
  item,
  attachment,
  mode = "set_default",
  onSaved,
  onOpenOnce,
}: SetCustomAppFormProps) {
  const { pop } = useNavigation();
  const isOneTime = mode === "open_once";

  const fileCategory = useMemo(() => getFileCategory(attachment.name), [attachment.name]);
  const suggestedApps = useMemo(() => getSuggestedAppsForFile(attachment.name), [attachment.name]);

  const appOptions = useMemo(() => {
    return [
      { id: "", title: "Windows Default Application" },
      ...suggestedApps.map((a) => ({ id: a.id, title: a.title })),
      { id: "__custom__", title: "Custom Executable Path (or Browse)..." },
    ];
  }, [suggestedApps]);

  const initialPreset = appOptions.find((a) => a.id === (attachment.customAppPath || ""))
    ? attachment.customAppPath || ""
    : attachment.customAppPath
      ? "__custom__"
      : "";

  const [selectedPreset, setSelectedPreset] = useState<string>(initialPreset);
  const [customPath, setCustomPath] = useState<string>(
    initialPreset === "__custom__" ? attachment.customAppPath || "" : "",
  );
  const [isProcessing, setIsProcessing] = useState(false);

  async function handleBrowse() {
    try {
      await showToast({ style: Toast.Style.Animated, title: "Opening File Picker..." });
      const selected = await browseExecutableOnWindows();
      if (selected) {
        setSelectedPreset("__custom__");
        setCustomPath(selected);
        await showToast({
          style: Toast.Style.Success,
          title: "Application Selected",
          message: selected,
        });
      }
    } catch (err) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Could not open file picker",
        message: String(err),
      });
    }
  }

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
          title: "Opening App Saved",
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
          <Action
            title="Browse App on PC…"
            icon={Icon.Finder}
            shortcut={{ modifiers: ["ctrl"], key: "b" }}
            onAction={handleBrowse}
          />
        </ActionPanel>
      }
    >
      <Form.Description
        title={isOneTime ? `Open "${attachment.name}" with... (One Time)` : `Configure Opener for "${attachment.name}"`}
        text={
          isOneTime
            ? `Choose an application to open this ${fileCategory} right now. This will NOT change your saved default application.`
            : `Item: "${item.title}"\nChoose which application should open this ${fileCategory} by default every time you press Enter.`
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
        {appOptions.map((app) => (
          <Form.Dropdown.Item key={app.id} value={app.id} title={app.title} />
        ))}
      </Form.Dropdown>

      {selectedPreset === "__custom__" ? (
        <Form.TextField
          id="customApp"
          title="Executable Path"
          placeholder="e.g. C:\\Program Files\\App\\app.exe (or press Ctrl+B to browse)"
          value={customPath}
          onChange={setCustomPath}
        />
      ) : null}

      <Form.Description
        text={
          selectedPreset === "__custom__"
            ? "Tip: Press Ctrl + B or select 'Browse App on PC...' from the action menu to pick any .exe directly from your computer."
            : `Only apps compatible with ${fileCategory} files are listed here. You can also select 'Browse' to choose any other app on your PC.`
        }
      />
    </Form>
  );
}
