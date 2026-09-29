import { Modal, Button } from './ui'

export default function UnsavedChangesModal(props: {
  isOpen: boolean
  modelName: string
  saving: boolean
  onSave: () => void
  onDiscard: () => void
  onCancel: () => void
}) {
  return (
    <Modal
      isOpen={props.isOpen}
      onClose={props.onCancel}
      title="Unsaved Changes"
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={props.onCancel} disabled={props.saving}>
            Cancel
          </Button>
          <Button variant="danger" onClick={props.onDiscard} disabled={props.saving}>
            Don't Save
          </Button>
          <Button variant="primary" onClick={props.onSave} disabled={props.saving}>
            {props.saving ? 'Saving…' : 'Save & Exit'}
          </Button>
        </>
      }
    >
      <p>
        <strong>{props.modelName}</strong> has unsaved changes. Save the project before exiting?
      </p>
    </Modal>
  )
}
