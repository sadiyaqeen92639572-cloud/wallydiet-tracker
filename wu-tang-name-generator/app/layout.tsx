import type {Metadata} from 'next';
import { Inter, Bebas_Neue, JetBrains_Mono } from 'next/font/google';
import './globals.css'; // Global styles

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
});

const bebasNeue = Bebas_Neue({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-bebas',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: 'Wu-Tang Clan Rap Name Generator: Choose Your Style and Create Your Alias',
  description: 'Use the Wu-Tang clan rap name generator to pick a style and create a unique rap alias. Try classic, Shaolin, street, mystic, and hardcore options.',
  keywords: ['wu tang name generator', 'rap name generator', 'hip hop name generator', 'wu tang clan name', 'wu tang alias'],
  alternates: {
    canonical: 'https://sadiyaqeen92639572-cloud.github.io/wu-tang-name-generator/',
  },
  metadataBase: new URL('https://sadiyaqeen92639572-cloud.github.io/wu-tang-name-generator'),
  openGraph: {
    title: "Wu-Tang Name Generator — What's Your Rap Name?",
    description: "Find out your Wu-Tang Clan alias instantly. Free rap name generator.",
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: "Wu-Tang Name Generator — What's Your Rap Name?",
    description: "Find out your Wu-Tang Clan alias instantly. Free rap name generator.",
  },
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en" className={`${inter.variable} ${bebasNeue.variable} ${jetbrainsMono.variable}`}>
      <body suppressHydrationWarning className="bg-[#0a0a0a] text-white min-h-screen font-sans">{children}</body>
    </html>
  );
}
