declare module "nodemailer" {
  export type SendMailOptions = {
    from: string;
    to: string;
    subject: string;
    text: string;
    attachments?: Array<{ filename: string; path: string }>;
  };

  export type Transporter = {
    sendMail(options: SendMailOptions): Promise<unknown>;
  };

  export function createTransport(options: unknown): Transporter;

  const nodemailer: {
    createTransport: typeof createTransport;
  };

  export default nodemailer;
}
