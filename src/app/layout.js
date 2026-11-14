import './globals.css';

export const metadata = {
  title: 'Minimi AI — Research & Memory Agent',
  description: 'Conversational AI research agent with temporal memory and bounded web search',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" data-theme="dark">
      <body>{children}</body>
    </html>
  );
}
