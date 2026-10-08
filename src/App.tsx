import { useEffect } from 'react';
import { Route, Switch, useLocation } from 'wouter';
import { BottomNav } from './components/BottomNav';
import { UpdateBanner } from './components/UpdateBanner';
import { openUserDb } from './data/db';
import { PlanProvider } from './data/plan';
import { startUserSession } from './data/session';
import { loadMe, ownAthlete, useAuth } from './lib/auth';
import { InvitePage, LoginPage, OnboardingPage, Splash } from './pages/AuthPages';
import { ExerciseHistoryPage } from './pages/ExerciseHistoryPage';
import { HistoryPage } from './pages/HistoryPage';
import { MobilityPage } from './pages/MobilityPage';
import { ProposalPage, ProposalsPage } from './pages/ProposalPage';
import { SessionRoute } from './pages/SessionLinkPage';
import { SettingsPage } from './pages/SettingsPage';
import { TodayPage } from './pages/TodayPage';
import { WeekPage } from './pages/WeekPage';

export function App() {
  const auth = useAuth();
  const [location] = useLocation();
  const userId = auth.status === 'in' ? auth.me.user.id : undefined;

  // Brugeren og adgangene hentes ved start og igen, når appen får fokus (fx en ny trænerrolle).
  useEffect(() => {
    void loadMe();
    const onVisible = () => document.visibilityState === 'visible' && navigator.onLine && void loadMe();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  useEffect(() => {
    if (auth.status === 'in') startUserSession(auth.me);
    // Kun når brugeren skifter, ikke ved hver opdatering af /api/me.
  }, [userId]);

  // /invite/<token> virker, uanset om nogen er logget ind.
  const invite = location.match(/^\/invite\/([^/?#]+)/);
  if (invite) return <InvitePage token={decodeURIComponent(invite[1])} />;
  if (auth.status === 'loading') return <Splash />;
  if (auth.status === 'out' || location === '/login') return <LoginPage />;
  if (!auth.me.user.onboarded) return <OnboardingPage me={auth.me} />;
  const own = ownAthlete(auth.me);
  if (!own) return <Splash />;

  // Den lokale database skal være åben, før skærmene læser fra den.
  openUserDb(auth.me.user.id);

  return (
    <PlanProvider key={own.slug} slug={own.slug}>
      <Switch>
        <Route path="/session/:id" component={SessionRoute} />
        <Route path="/mobilitet" component={MobilityPage} />
        <Route path="/ankel" component={MobilityPage} />
        <Route path="/uge" component={WeekPage} />
        <Route path="/historik/oevelse/:id" component={ExerciseHistoryPage} />
        <Route path="/historik" component={HistoryPage} />
        <Route path="/forslag/:id" component={ProposalPage} />
        <Route path="/forslag" component={ProposalsPage} />
        <Route path="/indstillinger" component={SettingsPage} />
        <Route component={TodayPage} />
      </Switch>
      {/* Under logning fylder timeren bunden; navigationen er "← I dag" i toppen. */}
      {/* Opdateringsbjælken vises ikke midt i en session. */}
      {!location.startsWith('/session/') && <UpdateBanner />}
      {!location.startsWith('/session/') && <BottomNav />}
    </PlanProvider>
  );
}
