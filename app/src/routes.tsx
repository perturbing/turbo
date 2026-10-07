import { createHashRouter, Navigate } from 'react-router-dom';
import { App } from './App';
import { CatalogueScreen } from './screens/workouts/CatalogueScreen';
import { WorkoutSetupScreen } from './screens/workouts/WorkoutSetupScreen';
import { BuilderScreen } from './screens/workouts/BuilderScreen';
import { LiveRideScreen } from './screens/ride/LiveRideScreen';
import { CompletionScreen } from './screens/ride/CompletionScreen';
import { TrainingLevelScreen } from './screens/training/TrainingLevelScreen';
import { RampTestScreen } from './screens/training/RampTestScreen';
import { RampResultScreen } from './screens/training/RampResultScreen';
import { DevicesScreen } from './screens/devices/DevicesScreen';
import { CalendarScreen } from './screens/calendar/CalendarScreen';
import { YourDataScreen } from './screens/data/YourDataScreen';
import { RecordingDetailScreen } from './screens/data/RecordingDetailScreen';

// Hash routing keeps the app servable from any static file host.
export const router = createHashRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <Navigate to="/workouts" replace /> },
      { path: 'workouts', element: <CatalogueScreen /> },
      { path: 'workouts/:id/setup', element: <WorkoutSetupScreen /> },
      { path: 'builder/:id?', element: <BuilderScreen /> },
      { path: 'ride', element: <LiveRideScreen /> },
      { path: 'complete', element: <CompletionScreen /> },
      { path: 'calendar', element: <CalendarScreen /> },
      { path: 'training', element: <TrainingLevelScreen /> },
      { path: 'training/ramp', element: <RampTestScreen /> },
      { path: 'training/result', element: <RampResultScreen /> },
      { path: 'devices', element: <DevicesScreen /> },
      { path: 'data', element: <YourDataScreen /> },
      { path: 'data/:recordingId', element: <RecordingDetailScreen /> },
      { path: '*', element: <Navigate to="/workouts" replace /> },
    ],
  },
]);
