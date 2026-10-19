/**
 * The custom connection form and its conversion to a stored connection. Every
 * field is a plain value; trust in an endpoint comes only from the explicit
 * checkbox, and only an endpoint other than the official one needs it.
 */
import { ADAPTERS, CREDENTIAL_REF, CUSTOM_CONNECTION_ID, type AdapterId, type ModelProtocol } from '../../catalog.ts'
import type { CustomConnection, ModelOptions } from '../../settings/types.ts'
import { adapterFields, applyFields, fieldText, isValidText, modelFields, type FieldSpec, type FieldTexts } from './model.ts'

interface Common {
  readonly id: string
  readonly label: string
  readonly credentialRef: string
  /** Option texts by field name; empty means the default. */
  readonly options: FieldTexts
}

export type ConnectionForm =
  | Common & { readonly kind: 'structured'; readonly adapter: AdapterId; readonly endpoint: string }
  | Common & { readonly kind: 'model'; readonly protocol: ModelProtocol; readonly model: string; readonly baseURL: string }

export type ConnectionKind = ConnectionForm['kind']

export type FormError = 'id' | 'duplicate' | 'label' | 'credentialRef' | 'endpoint' | 'model' | 'baseURL' | 'options' | 'trust'

export type BuildResult =
  | { readonly ok: true; readonly id: string; readonly connection: CustomConnection }
  | { readonly ok: false; readonly error: FormError }

/** Every custom connection id starts with this; the editor shows it as a fixed prefix. */
export const CUSTOM_PREFIX = 'custom:'

export function emptyForm(kind: ConnectionKind): ConnectionForm {
  const common = { id: CUSTOM_PREFIX, label: '', credentialRef: '', options: {} }
  return kind === 'structured'
    ? { ...common, kind, adapter: 'exa', endpoint: '' }
    : { ...common, kind, protocol: 'openai-responses', model: '', baseURL: '' }
}

const textsOf = (options: object | undefined): FieldTexts =>
  Object.fromEntries(Object.entries(options ?? {}).map(([name, value]) => [name, fieldText(value)]))

/** The form a stored connection opens with. */
export function formOf(id: string, connection: CustomConnection): ConnectionForm {
  const common = { id, label: connection.label, options: textsOf(connection.options) }
  return connection.kind === 'structured'
    ? { ...common, kind: 'structured', adapter: connection.adapter, credentialRef: connection.credentialRef, endpoint: connection.endpoint ?? '' }
    : {
      ...common, kind: 'model', protocol: connection.binding.protocol, model: connection.binding.model,
      baseURL: connection.binding.baseURL, credentialRef: connection.binding.credentialRef,
    }
}

/** Options the form offers: the adapter's personal-key options, or the model protocol's. */
export const formFields = (form: ConnectionForm): FieldSpec[] =>
  form.kind === 'structured' ? adapterFields(form.adapter, 'api-key').fields : modelFields(form.protocol)

/** Model endpoints are always the user's; a service endpoint is only when it is not the official one. */
export function needsTrust(form: ConnectionForm): boolean {
  return form.kind === 'model' || (form.endpoint.trim() !== '' && form.endpoint.trim() !== ADAPTERS[form.adapter].endpoint)
}

/** Whether to ask for trust yet: only once there is an address to trust. */
export function asksTrust(form: ConnectionForm): boolean {
  return form.kind === 'model' ? form.baseURL.trim() !== '' : needsTrust(form)
}

/** A credential reference derived from the id, e.g. custom:work-search → CUSTOM_WORK_SEARCH_API_KEY. */
export function suggestCredentialRef(id: string): string {
  const name = id.slice(CUSTOM_PREFIX.length).toUpperCase().replace(/[^A-Z0-9]+/gu, '_').replace(/^_+|_+$/gu, '')
  return name === '' ? '' : `CUSTOM_${name}_API_KEY`
}

function trimmed(form: ConnectionForm): ConnectionForm {
  const common = { id: form.id.trim(), label: form.label.trim(), credentialRef: form.credentialRef.trim() }
  return form.kind === 'structured'
    ? { ...form, ...common, endpoint: form.endpoint.trim() }
    : { ...form, ...common, model: form.model.trim(), baseURL: form.baseURL.trim() }
}

const isHttpUrl = (text: string): boolean => URL.canParse(text) && /^https?:$/u.test(new URL(text).protocol)

/**
 * Validate what the page can check locally; the Host validates the rest when the write arrives.
 * @param taken - ids already used by other connections.
 * @param previous - the stored connection being edited, whose switch state is kept.
 */
export function buildConnection(input: ConnectionForm, consent: boolean, taken: readonly string[], previous?: CustomConnection): BuildResult {
  const fail = (error: FormError): BuildResult => ({ ok: false, error })
  const form = trimmed(input)
  if (!CUSTOM_CONNECTION_ID.test(form.id)) return fail('id')
  if (taken.includes(form.id)) return fail('duplicate')
  if (form.label === '') return fail('label')
  const { credentialRef } = form
  if (!CREDENTIAL_REF.test(credentialRef)) return fail('credentialRef')
  const fields = formFields(form)
  if (!fields.every(field => isValidText(field, form.options[field.name] ?? ''))) return fail('options')
  if (form.kind === 'structured' && form.endpoint !== '' && !isHttpUrl(form.endpoint)) return fail('endpoint')
  if (form.kind === 'model' && form.model === '') return fail('model')
  if (form.kind === 'model' && !isHttpUrl(form.baseURL)) return fail('baseURL')
  const trusted = needsTrust(form)
  if (trusted && !consent) return fail('trust')

  const options = applyFields(fields, form.options, {})
  const extras = {
    ...previous?.disabled === undefined ? {} : { disabled: previous.disabled },
    ...Object.keys(options).length === 0 ? {} : { options },
  }
  const { label } = form
  return {
    ok: true,
    id: form.id,
    connection: form.kind === 'structured'
      ? {
        kind: 'structured', label, adapter: form.adapter, credentialRef,
        ...form.endpoint === '' ? {} : { endpoint: form.endpoint },
        ...trusted ? { trustedEndpoint: true } : {},
        ...extras,
      }
      : {
        kind: 'model', label, trustedEndpoint: true,
        binding: { mode: 'fixed', protocol: form.protocol, model: form.model, baseURL: form.baseURL, credentialRef },
        ...extras as { disabled?: boolean; options?: ModelOptions },
      },
  }
}