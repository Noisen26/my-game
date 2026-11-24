import { html } from '../html.js';
import { csrfField, errorBlock } from './layout.js';

const shell = (title, sub, body) => html`
<div class="auth">
  <h1>${title}</h1>
  ${sub ? html`<p class="muted">${sub}</p>` : ''}
  ${body}
</div>`;

export const signupPage = ({ csrf, error, values = {} }) =>
  shell(
    'Create your account',
    'Free while in beta. Takes a minute.',
    html`${errorBlock(error)}
<form method="post" action="/signup" class="form">
  ${csrfField(csrf)}
  <label>Artist name <input name="display_name" required maxlength="80" value="${values.display_name}" autocomplete="name"></label>
  <label>Profile address
    <span class="input-prefix"><span>/artist/</span><input name="handle" required pattern="[a-zA-Z0-9_\\-]{3,30}" maxlength="30" value="${values.handle}" autocomplete="username"></span>
    <small class="muted">3–30 letters, numbers, - or _</small></label>
  <label>E-mail <input type="email" name="email" required maxlength="200" value="${values.email}" autocomplete="email"></label>
  <label>Password <input type="password" name="password" required minlength="10" maxlength="200" autocomplete="new-password">
    <small class="muted">At least 10 characters</small></label>
  <label class="check"><input type="checkbox" name="terms" value="1" required> I confirm I own the rights to the works I register and accept the <a href="/terms" target="_blank">terms</a>.</label>
  <button class="btn btn-block">Create account</button>
</form>
<p class="muted small">Already have an account? <a href="/login">Sign in</a></p>`,
  );

export const loginPage = ({ csrf, error, next, email }) =>
  shell(
    'Sign in',
    '',
    html`${errorBlock(error)}
<form method="post" action="/login" class="form">
  ${csrfField(csrf)}
  <input type="hidden" name="next" value="${next}">
  <label>E-mail <input type="email" name="email" required value="${email}" autocomplete="email"></label>
  <label>Password <input type="password" name="password" required autocomplete="current-password"></label>
  <button class="btn btn-block">Sign in</button>
</form>
<p class="muted small"><a href="/forgot">Forgot your password?</a> · New here? <a href="/signup">Create an account</a></p>`,
  );

export const forgotPage = ({ csrf }) =>
  shell(
    'Reset your password',
    "Enter your e-mail and we'll send you a link to choose a new password.",
    html`<form method="post" action="/forgot" class="form">
  ${csrfField(csrf)}
  <label>E-mail <input type="email" name="email" required autocomplete="email"></label>
  <button class="btn btn-block">Send reset link</button>
</form>`,
  );

export const resetPage = ({ csrf, token, error }) =>
  shell(
    'Choose a new password',
    '',
    html`${errorBlock(error)}
<form method="post" action="/reset" class="form">
  ${csrfField(csrf)}
  <input type="hidden" name="token" value="${token}">
  <label>New password <input type="password" name="password" required minlength="10" maxlength="200" autocomplete="new-password"></label>
  <button class="btn btn-block">Save password</button>
</form>`,
  );
