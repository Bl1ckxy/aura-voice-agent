import './globals.css';

export const metadata = {
  title: 'Aura Skincare Voice Agent',
  description: 'AI-powered voice support for Aura Skincare',
  icons: {
    icon: '/favicon.svg',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-cream text-gray-900">
        {children}
      </body>
    </html>
  );
}