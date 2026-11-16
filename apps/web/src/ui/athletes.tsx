import { useCallback, useEffect, useRef, useState } from 'react';
import { request, type Athlete, type Member, type ResponsibleCoach } from './api';
import { ActionForm, FormError, LoadedPanel, signedIn, useSignedInLoad } from './components';
import { copy } from './copy';

type Roster = { athletes: Athlete[]; coaches: ResponsibleCoach[] };

const athletesPath = (organizationId: string) =>
  `/organizations/${encodeURIComponent(organizationId)}/athletes`;

function CoachChips({ athlete }: { athlete: Athlete }) {
  if (athlete.coaches.length === 0)
    return <p className="entry-meta entry-warning">{copy.athletes.unassigned}</p>;
  return (
    <ul className="roles" aria-label={copy.athletes.coachesOf(athlete.email)}>
      {athlete.coaches.map((coach) => (
        <li key={coach.accountId} className="role-chip person-chip">
          {coach.email}
        </li>
      ))}
    </ul>
  );
}

function AthleteEntry({
  organizationId,
  athlete,
  self,
  coaches,
  onChanged,
}: {
  organizationId: string;
  athlete: Athlete;
  self: boolean;
  /** Coaches the administrator can choose from; absent for coaches, who only look. */
  coaches?: ResponsibleCoach[];
  onChanged: (athlete: Athlete) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const assignButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  // Closing the editor returns focus to the control that opened it, once that is rendered again.
  useEffect(() => {
    if (editing || !returnFocus.current) return;
    returnFocus.current = false;
    assignButton.current?.focus();
  }, [editing]);
  const close = () => {
    returnFocus.current = true;
    setEditing(false);
  };
  const assigned = new Set(athlete.coaches.map((coach) => coach.accountId));
  return (
    <li className="entry">
      <div className="entry-details">
        <p className="entry-title">
          {athlete.email}
          {self && <span className="entry-tag">{copy.members.selfTag}</span>}
        </p>
        <CoachChips athlete={athlete} />
        {saved && !editing && (
          <p className="success entry-feedback" role="status">
            {copy.athletes.saved(athlete.email)}
          </p>
        )}
      </div>
      {coaches && coaches.length > 0 && editing && (
        <div className="entry-editor">
          <ActionForm
            label={copy.athletes.save}
            validationMessage={copy.athletes.coachesChanged}
            action={async (data) => {
              const chosen = data.getAll('coaches').map(String);
              if (chosen.length === 0) throw new FormError(copy.athletes.atLeastOneCoach);
              const updated = await signedIn(() =>
                request<Athlete>(
                  `${athletesPath(organizationId)}/${encodeURIComponent(athlete.accountId)}`,
                  { coaches: chosen },
                  'PATCH',
                ),
              );
              if (!updated) return;
              onChanged(updated);
              setSaved(true);
              close();
            }}
          >
            <fieldset
              className="checkboxes"
              aria-label={copy.athletes.coachesResponsibleFor(athlete.email)}
            >
              <legend>{copy.athletes.coachesLegend}</legend>
              {coaches.map((coach) => (
                <label key={coach.accountId} className="checkbox">
                  <input
                    type="checkbox"
                    name="coaches"
                    value={coach.accountId}
                    defaultChecked={assigned.has(coach.accountId)}
                  />
                  <span className="checkbox-text">{coach.email}</span>
                </label>
              ))}
            </fieldset>
          </ActionForm>
          <button className="text-button" type="button" onClick={close}>
            {copy.athletes.cancel}
          </button>
        </div>
      )}
      {coaches && coaches.length > 0 && !editing && (
        <div className="entry-actions">
          <button
            ref={assignButton}
            className="secondary"
            type="button"
            aria-label={copy.athletes.assignTo(athlete.email)}
            onClick={() => {
              setSaved(false);
              setEditing(true);
            }}
          >
            {copy.athletes.assign}
          </button>
        </div>
      )}
    </li>
  );
}

/**
 * Administrators review every athlete and assign their responsible coaches; coaches see the
 * athletes they are responsible for. Remount it (with a new key) when member roles change.
 */
export function AthletesSection({
  organizationId,
  accountEmail,
  administrator,
}: {
  organizationId: string;
  accountEmail: string;
  administrator: boolean;
}) {
  const loadRoster = useCallback(async (): Promise<Roster> => {
    const [athletes, members] = await Promise.all([
      request<Athlete[]>(athletesPath(organizationId)),
      administrator
        ? request<Member[]>(`/organizations/${encodeURIComponent(organizationId)}/members`)
        : Promise.resolve([]),
    ]);
    const coaches = members
      .filter((member) => member.roles.includes('coach'))
      .map(({ accountId, email }) => ({ accountId, email }))
      .sort((a, b) => a.email.localeCompare(b.email));
    return { athletes, coaches };
  }, [organizationId, administrator]);
  const load = useSignedInLoad(loadRoster);
  const [updated, setUpdated] = useState<Record<string, Athlete>>({});
  const rosterLoad =
    load.state === 'ready'
      ? {
          state: 'ready' as const,
          data: {
            ...load.data,
            athletes: load.data.athletes.map((athlete) => updated[athlete.accountId] ?? athlete),
          },
        }
      : load;
  return (
    <LoadedPanel
      labelledBy="organization-athletes"
      title={copy.athletes.title}
      description={administrator ? copy.athletes.adminDescription : copy.athletes.coachDescription}
      load={rosterLoad}
      failure={copy.athletes.loadFailed}
    >
      {({ athletes, coaches }) => (
        <>
          {administrator && coaches.length === 0 && athletes.length > 0 && (
            <p className="panel-note">{copy.athletes.noCoachesInOrganization}</p>
          )}
          {athletes.length === 0 ? (
            <p className="panel-empty">
              {administrator ? copy.athletes.empty : copy.athletes.noneAssigned}
            </p>
          ) : (
            <ul className="entry-list">
              {athletes.map((athlete) => (
                <AthleteEntry
                  key={athlete.accountId}
                  organizationId={organizationId}
                  athlete={athlete}
                  self={athlete.email.toLowerCase() === accountEmail.toLowerCase()}
                  coaches={administrator ? coaches : undefined}
                  onChanged={(changed) =>
                    setUpdated((current) => ({ ...current, [changed.accountId]: changed }))
                  }
                />
              ))}
            </ul>
          )}
        </>
      )}
    </LoadedPanel>
  );
}
