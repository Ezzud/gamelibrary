import { Check, X } from 'lucide-react'
import type { LaunchFilePickerModalProps } from '../types/appTypes'

const LaunchFilePickerModal = ({
  isOpen,
  gameName,
  launchFiles,
  selectedLaunchFile,
  onSelect,
  onConfirm,
  onCancel,
}: LaunchFilePickerModalProps) => {
  if (!isOpen) {
    return null
  }

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-lg bg-[#1b2838]! border border-steam-600 shadow-2xl">
        <div className="px-4 py-3 border-b border-steam-700 flex items-center justify-between">
          <h3 className="text-white font-semibold">Choose launch file</h3>
          <button
            type="button"
            onClick={onCancel}
            className="w-7 h-7 rounded bg-steam-700 hover:bg-steam-600 transition-colors inline-flex items-center justify-center"
            aria-label="Close launch file picker"
          >
            <X className="w-4 h-4 text-white" />
          </button>
        </div>

        <div className="px-4 py-3">
          <p className="text-sm text-steam-300 mb-3">
            First launch detected for <span className="text-white font-medium">{gameName}</span>. Select which executable should be used.
          </p>

          <div className="space-y-2 max-h-56 overflow-auto pr-1">
            {launchFiles.map((file) => (
              <label
                key={file}
                className="flex items-center gap-2 rounded-lg bg-steam-900 px-3 py-2 cursor-pointer hover:bg-steam-700 transition-colors"
              >
                <input
                  type="radio"
                  name="launch-file"
                  value={file}
                  checked={selectedLaunchFile === file}
                  onChange={() => onSelect(file)}
                  className="accent-steam-400"
                />
                <span className="text-sm text-white truncate">{file}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="px-4 py-3 border-t border-steam-700 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-2 rounded bg-steam-700 hover:bg-steam-600 text-white text-sm transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!selectedLaunchFile}
            className="px-3 py-2 rounded bg-steam-500 hover:bg-steam-400 disabled:opacity-50 text-white text-sm transition-colors inline-flex items-center gap-2"
          >
            <Check className="w-4 h-4" />
            Confirm
          </button>
        </div>
      </div>
    </div>
  )
}

export default LaunchFilePickerModal
