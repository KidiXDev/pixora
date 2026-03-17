import HomePage from '@/pages/home-page';
import ImageGenerationPage from '@/pages/image-generation-page';
import SettingsPage from '@/pages/settings-page';
import { createBrowserRouter, Outlet } from 'react-router-dom';
import { BaseLayout } from '../components/layout/base-layout';

const RootLayout = () => {
  return (
    <BaseLayout>
      <Outlet />
    </BaseLayout>
  );
};

export const router = createBrowserRouter([
  {
    path: '/',
    element: <RootLayout />,
    children: [
      {
        index: true,
        element: <HomePage />
      },
      {
        path: 'settings',
        element: <SettingsPage />
      },
      {
        path: 'image-generation',
        element: <ImageGenerationPage />
      }
    ]
  }
]);
