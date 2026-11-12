import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ApiError, redirectIfSignedOut, request, type Account, type Organization } from './api';
import {
  ActionForm,
  Brand,
  Card,
  CardPage,
  PendingLoad,
  useFocusOnChange,
  useSignedInLoad,
} from './components';
import { copy } from './copy';

const LAST_ORGANIZATION_KEY = 'wodyssey:last-organization';

function rememberOrganization(id: string): void {
  try {
    localStorage.setItem(LAST_ORGANIZATION_KEY, id);
  } catch {
    // Remembering the last organization is a convenience; storage may be unavailable.
  }
}

function recallOrganization(organizations: Organization[]): Organization | undefined {
  let remembered: string | null = null;
  try {
    remembered = localStorage.getItem(LAST_ORGANIZATION_KEY);
  } catch {
    remembered = null;
  }
  return organizations.find(({ id }) => id === remembered) ?? organizations[0];
}

const organizationPath = (id: string) => `/organizations/${encodeURIComponent(id)}`;

function OrganizationNameField({ defaultValue = '' }: { defaultValue?: string }) {
  const id = useId();
  return (
    <>
      <label htmlFor={id}>{copy.organizations.nameLabel}</label>
      <input
        id={id}
        name="name"
        type="text"
        autoComplete="organization"
        required
        maxLength={80}
        defaultValue={defaultValue}
      />
    </>
  );
}

/** Creates an organization administered by the signed-in account, then opens it. */
function CreateOrganizationForm() {
  return (
    <ActionForm
      label={copy.organizations.create}
      validationMessage={copy.organizations.nameInvalid}
      action={async (data) => {
        try {
          const organization = await request<Organization>('/organizations', {
            name: String(data.get('name')).trim(),
          });
          rememberOrganization(organization.id);
          window.location.assign(organizationPath(organization.id));
        } catch (error) {
          if (!redirectIfSignedOut(error)) throw error;
        }
      }}
    >
      <OrganizationNameField />
    </ActionForm>
  );
}

const loadHome = () =>
  Promise.all([request<Account>('/auth/me'), request<Organization[]>('/organizations')]);

/** Landing screen: resumes an organization, or offers to create the first one. */
export function PrivateHome() {
  const load = useSignedInLoad(loadHome);
  const resume = load.state === 'ready' ? recallOrganization(load.data[1]) : undefined;
  useEffect(() => {
    if (resume) window.location.replace(organizationPath(resume.id));
  }, [resume]);
  if (load.state !== 'ready' || resume) return <PendingLoad load={{ state: 'loading' }} />;
  const [account] = load.data;
  return (
    <CardPage>
      <Card eyebrow={copy.yourAccount} title={copy.privateTitle}>
        <p className="lede">{copy.organizations.noneDescription}</p>
        <CreateOrganizationForm />
        <p className="account-email">
          {copy.signedInAs} <strong>{account.email}</strong>
        </p>
        <SignOutForm />
      </Card>
    </CardPage>
  );
}

export function NewOrganization() {
  return (
    <CardPage>
      <Card eyebrow={copy.organizations.newEyebrow} title={copy.organizations.newTitle}>
        <p className="lede">{copy.organizations.newDescription}</p>
        <CreateOrganizationForm />
        <p className="switch">
          <a href="/home">{copy.organizations.cancel}</a>
        </p>
      </Card>
    </CardPage>
  );
}

function SignOutForm() {
  return (
    <ActionForm
      label={copy.signOut}
      secondary
      action={async () => {
        await request('/auth/logout', {});
        window.location.replace('/login');
      }}
    />
  );
}

/**
 * Button that reveals a panel of links. Escape or moving focus elsewhere closes it,
 * and Escape returns focus to the button.
 */
function Disclosure({
  label,
  className,
  button,
  children,
}: {
  label: string;
  className: string;
  button: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open]);
  return (
    <div
      ref={container}
      className={`disclosure ${className}`}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          setOpen(false);
          trigger.current?.focus();
        }
      }}
      onBlur={(event) => {
        const next = event.relatedTarget as Node | null;
        if (next && !event.currentTarget.contains(next)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="disclosure-button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
      >
        {button}
        <span className="chevron" aria-hidden="true" />
      </button>
      <div id={panelId} className="disclosure-panel" hidden={!open}>
        {children}
      </div>
    </div>
  );
}

function OrganizationContext({
  current,
  organizations,
}: {
  current: Organization;
  organizations: Organization[];
}) {
  // With one organization there is nothing to choose; show it as a label.
  if (organizations.length < 2)
    return (
      <p className="organization-label">
        <span className="visually-hidden">{copy.organizations.current} </span>
        <span className="truncate">{current.name}</span>
      </p>
    );
  return (
    <Disclosure
      className="organization-switcher"
      label={copy.organizations.switchLabel.replace('{name}', current.name)}
      button={<span className="truncate">{current.name}</span>}
    >
      <p className="panel-heading">{copy.organizations.yourOrganizations}</p>
      <ul className="panel-list">
        {organizations.map((organization) => (
          <li key={organization.id}>
            <a
              href={organizationPath(organization.id)}
              aria-current={organization.id === current.id ? 'page' : undefined}
            >
              <span className="truncate">{organization.name}</span>
            </a>
          </li>
        ))}
      </ul>
    </Disclosure>
  );
}

function AccountMenu({ account }: { account: Account }) {
  return (
    <Disclosure
      className="account-menu"
      label={copy.organizations.accountLabel.replace('{email}', account.email)}
      button={
        <>
          <span className="avatar" aria-hidden="true">
            {account.email.charAt(0).toUpperCase()}
          </span>
          <span className="truncate account-menu-email">{account.email}</span>
        </>
      }
    >
      <p className="panel-account">
        {copy.signedInAs} <strong>{account.email}</strong>
      </p>
      <ul className="panel-list">
        <li>
          <a href="/organizations/new">{copy.organizations.newLink}</a>
        </li>
      </ul>
      <SignOutForm />
    </Disclosure>
  );
}

function RenameOrganizationForm({
  organization,
  onRenamed,
}: {
  organization: Organization;
  onRenamed: (organization: Organization) => void;
}) {
  const [saved, setSaved] = useState(false);
  return (
    <>
      <ActionForm
        label={copy.organizations.save}
        validationMessage={copy.organizations.nameInvalid}
        action={async (data) => {
          setSaved(false);
          try {
            const renamed = await request<Organization>(
              organizationPath(organization.id),
              { name: String(data.get('name')).trim() },
              'PATCH',
            );
            onRenamed(renamed);
            setSaved(true);
          } catch (error) {
            if (!redirectIfSignedOut(error)) throw error;
          }
        }}
      >
        <OrganizationNameField key={organization.name} defaultValue={organization.name} />
      </ActionForm>
      {saved && (
        <p className="success" role="status">
          {copy.organizations.saved}
        </p>
      )}
    </>
  );
}

type WorkspaceData = {
  account: Account;
  organization: Organization | null;
  organizations: Organization[];
};

/** Everything shown in a workspace comes from the organization in its address. */
export function OrganizationWorkspace({ id }: { id: string }) {
  const loadWorkspace = useCallback(async (): Promise<WorkspaceData> => {
    const [account, organizations, organization] = await Promise.all([
      request<Account>('/auth/me'),
      request<Organization[]>('/organizations'),
      request<Organization>(organizationPath(id)).catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }),
    ]);
    return { account, organizations, organization };
  }, [id]);
  const load = useSignedInLoad(loadWorkspace);
  if (load.state !== 'ready') return <PendingLoad load={load} />;
  if (!load.data.organization)
    return (
      <CardPage>
        <Card eyebrow={copy.organizations.eyebrow} title={copy.organizations.unavailableTitle}>
          <p className="lede">{copy.organizations.unavailableDescription}</p>
          <a className="primary button-link" href="/home">
            {copy.returnHome}
          </a>
        </Card>
      </CardPage>
    );
  return <Workspace {...load.data} organization={load.data.organization} />;
}

function Workspace({
  account,
  organization: loaded,
  organizations: loadedList,
}: WorkspaceData & { organization: Organization }) {
  const [organization, setOrganization] = useState(loaded);
  const [organizations, setOrganizations] = useState(loadedList);
  const heading = useFocusOnChange<HTMLHeadingElement>(loaded.id);
  useEffect(() => rememberOrganization(loaded.id), [loaded.id]);
  const administrator = organization.roles.includes('administrator');
  return (
    <div className="shell">
      <header className="topbar">
        <a className="topbar-brand" href="/home" aria-label={copy.brand}>
          <Brand />
        </a>
        <OrganizationContext current={organization} organizations={organizations} />
        <AccountMenu account={account} />
      </header>
      <main className="workspace">
        <p className="eyebrow">{copy.organizations.eyebrow}</p>
        <h1 ref={heading} tabIndex={-1}>
          {organization.name}
        </h1>
        <ul className="roles" aria-label={copy.organizations.yourRoles}>
          {organization.roles.map((role) => (
            <li key={role} className="role-chip">
              {copy.organizations.roles[role]}
            </li>
          ))}
        </ul>
        <p className="lede">{copy.organizations.separationDescription}</p>
        {administrator && (
          <section className="panel" aria-labelledby="organization-settings">
            <h2 id="organization-settings">{copy.organizations.settingsTitle}</h2>
            <p className="panel-description">{copy.organizations.settingsDescription}</p>
            <RenameOrganizationForm
              organization={organization}
              onRenamed={(renamed) => {
                setOrganization(renamed);
                setOrganizations((list) =>
                  list.map((item) => (item.id === renamed.id ? renamed : item)),
                );
              }}
            />
          </section>
        )}
      </main>
      <footer className="shell-footer">{copy.footer}</footer>
    </div>
  );
}
