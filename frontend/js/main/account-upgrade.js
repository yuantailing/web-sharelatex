import App from '../base'

export default App.controller('FreeTrialModalController', function(
  $scope,
  eventTracking
) {
  $scope.buttonClass = 'btn-primary'

  $scope.startFreeTrial = function(source, version) {
    const plan = 'collaborator_free_trial_7_days'

    const w = window.open()
    const go = function() {
      let url
      if (typeof ga === 'function') {
        ga(
          'send',
          'event',
          'subscription-funnel',
          'upgraded-free-trial',
          source
        )
      }
      url = `/SHARELATEX/user/subscription/new?planCode=${plan}&ssp=true`
      url = `${url}&itm_campaign=${source}`
      if (version) {
        url = `${url}&itm_content=${version}`
      }

      $scope.startedFreeTrial = true

      eventTracking.sendMB('subscription-start-trial', { source, plan })

      w.location = url
    }

    go()
  }
})

App.controller('UpgradeModalController', function($scope, eventTracking) {
  $scope.buttonClass = 'btn-primary'

  $scope.upgradePlan = function(source) {
    const w = window.open()
    const go = function() {
      let url
      if (typeof ga === 'function') {
        ga('send', 'event', 'subscription-funnel', 'upgraded-plan', source)
      }
      url = '/SHARELATEX/user/subscription'
      $scope.startedFreeTrial = true

      w.location = url
    }

    go()
  }
})
