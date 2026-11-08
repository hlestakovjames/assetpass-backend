export interface JwtAccessPayload {
  sub: string;
  sid: string;
  jti: string;
  iat: number;
  exp: number;
  iss: string;
  aud: string | string[];
}
