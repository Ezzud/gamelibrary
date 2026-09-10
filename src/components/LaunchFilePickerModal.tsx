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
		<div className="launch-file-picker-overlay fixed inset-0 z-60 flex items-center justify-center p-4">
			<div className="launch-file-picker-panel w-full max-w-md rounded-lg shadow-2xl">
				<div className="launch-file-picker-header px-4 py-3 flex items-center justify-between">
					<h3 className="launch-file-picker-title font-semibold">Choose launch file</h3>
					<button
						type="button"
						onClick={onCancel}
						className="launch-file-picker-secondary-button w-7 h-7 rounded transition-colors inline-flex items-center justify-center"
						aria-label="Close launch file picker"
					>
						<X className="launch-file-picker-title w-4 h-4" />
					</button>
				</div>

				<div className="px-4 py-3">
					<p className="launch-file-picker-muted text-sm mb-3">
						First launch detected for <span className="launch-file-picker-title font-medium">{gameName}</span>. Select which executable should be used.
					</p>

					<div className="space-y-2 max-h-56 overflow-auto pr-1">
						{launchFiles.map((file) => (
							<label
								key={file}
								className="launch-file-picker-option flex items-center gap-2 rounded-lg px-3 py-2 cursor-pointer transition-colors"
							>
								<input
									type="radio"
									name="launch-file"
									value={file}
									checked={selectedLaunchFile === file}
									onChange={() => onSelect(file)}
									className="launch-file-picker-radio"
								/>
								<span className="launch-file-picker-title text-sm truncate">{file}</span>
							</label>
						))}
					</div>
				</div>

				<div className="launch-file-picker-footer px-4 py-3 flex items-center justify-end gap-2">
					<button
						type="button"
						onClick={onCancel}
						className="launch-file-picker-secondary-button px-3 py-2 rounded text-sm transition-colors"
					>
						Cancel
					</button>
					<button
						type="button"
						onClick={onConfirm}
						disabled={!selectedLaunchFile}
						className="launch-file-picker-primary-button px-3 py-2 rounded disabled:opacity-50 text-sm transition-colors inline-flex items-center gap-2"
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
