const APP_URL           = 'https://cred-360-60073973215.development.catalystserverless.in/app/';
const PROFILE_FOLDER_ID = '46135000000019444';
const FROM_EMAIL        = 'no-reply@catalystserverless.in';

const ROLE_MAP = {
  'App Administrator': 'Admin',
  'App User':          'Employee',
  'TeamLead':          'Team Lead',
  'Intern':            'Intern',
};
const ROLE_ID_MAP = {
  'Admin':     '46135000000013077',
  'Employee':  '46135000000022036',
  'Team Lead': '46135000000019457',
  'Intern':    '46135000000022038',
};
const INVITE_ROLE_ID_MAP = {
  'Admin':     '46135000000013077',
  'Employee':  '46135000000013078',
  'Team Lead': '46135000000019457',
  'Intern':    '46135000000013078',
};

module.exports = { APP_URL, PROFILE_FOLDER_ID, FROM_EMAIL, ROLE_MAP, ROLE_ID_MAP, INVITE_ROLE_ID_MAP };