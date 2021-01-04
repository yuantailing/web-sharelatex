import App from '../../../base'

export default App.factory('projectInvites', (ide, $http) => ({
  sendInvite(email, privileges, grecaptchaResponse) {
    return $http.post(`/SHARELATEX/project/${ide.project_id}/invite`, {
      email,
      privileges,
      _csrf: window.csrfToken,
      'g-recaptcha-response': grecaptchaResponse
    })
  },

  revokeInvite(inviteId) {
    return $http({
      url: `/SHARELATEX/project/${ide.project_id}/invite/${inviteId}`,
      method: 'DELETE',
      headers: {
        'X-Csrf-Token': window.csrfToken
      }
    })
  },

  resendInvite(inviteId, privileges) {
    return $http.post(`/SHARELATEX/project/${ide.project_id}/invite/${inviteId}/resend`, {
      _csrf: window.csrfToken
    })
  },

  getInvites() {
    return $http.get(`/SHARELATEX/project/${ide.project_id}/invites`, {
      json: true,
      headers: {
        'X-Csrf-Token': window.csrfToken
      }
    })
  }
}))
