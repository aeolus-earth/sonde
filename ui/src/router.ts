import { createRouter } from "@tanstack/react-router";
import { Route as rootRoute } from "./routes/__root";
import { Route as authenticatedRoute } from "./routes/_authenticated";
import { Route as loginRoute } from "./routes/login";
import { Route as authCallbackRoute } from "./routes/auth/callback";
import { Route as indexRoute } from "./routes/index";
import { Route as experimentsRoute } from "./routes/experiments/index";
import { Route as experimentDetailRoute } from "./routes/experiments/$id";
import { Route as treeRoute } from "./routes/tree";
import { Route as findingsRoute } from "./routes/findings";
import { Route as findingDetailRoute } from "./routes/findings/$id";
import { Route as directionsRoute } from "./routes/directions";
import { Route as directionDetailRoute } from "./routes/directions/$id";
import { Route as questionsRoute } from "./routes/questions";
import { Route as activityRoute } from "./routes/activity";
import { Route as briefRoute } from "./routes/brief";
import { Route as notFoundRoute } from "./routes/$";

const routeTree = rootRoute.addChildren([
  loginRoute,
  authCallbackRoute,
  authenticatedRoute.addChildren([
    indexRoute,
    experimentsRoute,
    experimentDetailRoute,
    treeRoute,
    findingsRoute,
    findingDetailRoute,
    directionsRoute,
    directionDetailRoute,
    questionsRoute,
    activityRoute,
    briefRoute,
    notFoundRoute,
  ]),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
