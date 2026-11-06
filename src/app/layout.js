import "./globals.css";

export const metadata = {
  title: "Clinic Booking",
  description: "Book and manage clinic appointments.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
