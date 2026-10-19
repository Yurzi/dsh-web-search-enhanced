/** One-time guidance after the user enables this bundle on the Plugins page. */
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { adapterList } from './connections.ts'
import type { NS } from './locales.ts'

export type ActivationPromptProps = PropsRuntime<'plugins.bundle.activation'> & PropsLocale<typeof NS>

export function ActivationPrompt({ onDismiss, onOpenDetails, t }: ActivationPromptProps) {
  return (
    <Modal
      open
      title={t('activation.title')}
      closeLabel={t('activation.close')}
      onClose={onDismiss}
      footer={(
        <>
          <Button variant="ghost" onClick={onDismiss}>{t('activation.later')}</Button>
          <Button variant="primary" data-modal-autofocus onClick={onOpenDetails}>{t('activation.open')}</Button>
        </>
      )}
    >
      <p>{t('activation.body', { services: adapterList(t, adapter => adapter.keyless) })}</p>
    </Modal>
  )
}
