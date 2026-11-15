import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/lib/theme";
import AppShell from "@/components/AppShell";
import AuthGate from "@/components/AuthGate";
import Today from "@/pages/Today";
import Trends from "@/pages/Trends";
import Regimen from "@/pages/Regimen";
import Data from "@/pages/Data";
import NotFound from "@/pages/not-found";

function AppRouter() {
  return (
    <AppShell>
      <Switch>
        <Route path="/" component={Today} />
        <Route path="/trends" component={Trends} />
        <Route path="/regimen" component={Regimen} />
        <Route path="/data" component={Data} />
        <Route component={NotFound} />
      </Switch>
    </AppShell>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <Toaster />
          <AuthGate>
            <Router hook={useHashLocation}>
              <AppRouter />
            </Router>
          </AuthGate>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
