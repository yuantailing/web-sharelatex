import App from '../../../base'
App.factory('projectMembers', (ide, $http) => ({
  removeMember(member) {
    return $http({
      url: `/SHARELATEX/project/${ide.project_id}/users/${member._id}`,
      method: 'DELETE',
      headers: {
        'X-Csrf-Token': window.csrfToken
      }
    })
  },

  addGroup(groupId, privileges) {
    return $http.post(`/SHARELATEX/project/${ide.project_id}/group`, {
      group_id: groupId,
      privileges,
      _csrf: window.csrfToken
    })
  },

  getMembers() {
    return $http.get(`/SHARELATEX/project/${ide.project_id}/members`, {
      json: true,
      headers: {
        'X-Csrf-Token': window.csrfToken
      }
    })
  },

  setMemberPrivilegeLevel(userId, privilegeLevel) {
    return $http.put(
      `/SHARELATEX/project/${ide.project_id}/users/${userId}`,
      { privilegeLevel },
      {
        headers: {
          'X-Csrf-Token': window.csrfToken
        }
      }
    )
  },

  transferOwnership(userId) {
    return $http.post(`/SHARELATEX/project/${ide.project_id}/transfer-ownership`, {
      user_id: userId,
      _csrf: window.csrfToken
    })
  }
}))
